import { get, writable } from 'svelte/store'
import { disabledExtensions, enabledExtensionUrls, extensionUrls } from '$lib/settings/ui'
import { playing } from '$lib/player/session'
import type { ExtensionCatalogPackage } from './catalog'
import type { InstalledExtensionPackage } from './manager'
import type { LoadedStore } from '$lib/store/load'

// Background auto-update for installed .izumi-ext packages. The manual path (the Update button in
// settings → sources) already trusts the listings' sha-pinned payloads; this runs the same install
// unprompted so a release actually reaches people who never revisit that page. Listings come from
// every enabled store plus any package catalog still configured only as a source.

/** One-line "Updated …" notice for the shell pill. Cleared automatically. */
export const extensionUpdateNotice = writable('')
let noticeTimer: ReturnType<typeof setTimeout> | null = null
function showNotice(text: string): void {
  extensionUpdateNotice.set(text)
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => extensionUpdateNotice.set(''), 8000)
}

export interface PackageListing {
  storeUrl: string
  packages: ExtensionCatalogPackage[]
}

export interface PackageUpdate {
  entry: ExtensionCatalogPackage
  storeUrl: string
}

/** The listed packages worth installing: version differs from what's on disk. The listing is
 *  canonical in BOTH directions — a rollback must propagate too, so this is `!==`, not a semver
 *  ordering. Installed packages absent from every listing (local sideloads) are left alone. A package
 *  with a recorded origin only updates from that store. One installed before origins were recorded
 *  only updates from a legacy store (see $lib/store/origins), and only as the same kind of package —
 *  no other store can claim it. */
export function collectPackageUpdates(
  installed: InstalledExtensionPackage[],
  listings: PackageListing[],
  origins: Readonly<Record<string, string>>,
  legacyStores: readonly string[],
): PackageUpdate[] {
  return installed.flatMap((extension) => {
    const origin = Object.hasOwn(origins, extension.id) ? origins[extension.id] : undefined
    // A background update never changes a package's kind (the installer would refuse it, after the
    // whole download): a new kind from the package's own store waits for the user to update it.
    const matches = (entry: ExtensionCatalogPackage) => entry.id === extension.id && entry.backend === extension.backend
    const listing = listings.find((candidate) =>
      (origin ? candidate.storeUrl === origin : legacyStores.includes(candidate.storeUrl))
      && candidate.packages.some(matches))
    const entry = listing?.packages.find(matches)
    return listing && entry && entry.version !== extension.version ? [{ entry, storeUrl: listing.storeUrl }] : []
  })
}

/** The store listings a background update may act on: stores that answered this time and passed
 *  their key check. A saved copy served because the refresh failed is skipped — it can be older than
 *  what is installed, and since listings are canonical in both directions it would roll packages back. */
export function freshPackageListings(results: ReadonlyArray<LoadedStore | null>): PackageListing[] {
  return results.flatMap((result) => result?.listing && !result.cached && !result.error && result.trust.state !== 'locked'
    ? [{
        storeUrl: result.store.url,
        packages: result.listing.entries.flatMap((entry) => entry.install.type === 'package' ? [entry.install.pkg] : []),
      }]
    : [])
}

// If a listing's `version` field disagrees with the version its package actually installs, the
// mismatch survives the install and every later check would reinstall it forever. Remember what was
// tried this session (id@listed-version) and never try it twice; a failed install is latched for
// the same reason — hammering a broken download every 6h helps nobody. Cleared by restart.
const attempted = new Set<string>()

export interface ExtensionUpdateCheckResult {
  updated: ExtensionCatalogPackage[]
  failed: number
  reason?: 'playback' | 'no-installed' | 'no-catalogs' | 'catalog-unavailable'
}

export interface ExtensionUpdateCheckOptions {
  retryAttempted?: boolean
  /** A manual check is an explicit request, so it may inspect stores and catalogs the user has
   *  disabled for background polling without changing their enabled state. */
  includeDisabledCatalogs?: boolean
}

/** Compare every installed package against the store listings and reinstall what changed. Never
 *  throws. Skipped entirely during playback: each install tears down the running worker set and the
 *  JVM runtime, which would kill an in-flight resolve. */
export async function checkExtensionUpdates(
  options: ExtensionUpdateCheckOptions = {},
): Promise<ExtensionUpdateCheckResult> {
  if (get(playing)) return { updated: [], failed: 0, reason: 'playback' }
  // The first check is delayed by 15 seconds; keep the extension manager, worker graph and store
  // layer out of the app-layout startup chunk until the check actually runs.
  const { fetchExtensionInfo, installCatalogPackage, installedExtensionPackages } = await import('./manager')
  const { allStores, enabledStores } = await import('$lib/store/feeds')
  const { loadStoreAndPin } = await import('$lib/store/service')
  const { currentLegacyStores, originKey, packageOrigins } = await import('$lib/store/origins')
  const installed = await installedExtensionPackages()
  if (!installed.length) return { updated: [], failed: 0, reason: 'no-installed' }
  // The theme store can never list packages; skipping it saves a fetch every six hours. A catalog
  // switched off on the Sources page is not polled even where it is also a store, and a store is never
  // polled a second time through its Sources entry: whichever switch is off wins.
  const switchedOff = new Set(get(disabledExtensions).map(originKey))
  const stores = get(options.includeDisabledCatalogs ? allStores : enabledStores)
    .filter((store) => store.id !== 'izumi-themes' && (options.includeDisabledCatalogs || !switchedOff.has(store.url)))
  const known = get(allStores)
  const legacy = get(options.includeDisabledCatalogs ? extensionUrls : enabledExtensionUrls)
    .filter((spec) => !known.some((store) => store.url === originKey(spec)))
  if (!stores.length && !legacy.length) return { updated: [], failed: 0, reason: 'no-catalogs' }
  const [loaded, infos] = await Promise.all([
    Promise.all(stores.map((store) => loadStoreAndPin(store, { force: true }).catch(() => null))),
    Promise.all(legacy.map((spec) => fetchExtensionInfo(spec).catch(() => null))),
  ])
  const listings: PackageListing[] = [
    ...freshPackageListings(loaded),
    ...legacy.flatMap((spec, index) => {
      const packages = infos[index]?.packages
      return packages ? [{ storeUrl: originKey(spec), packages }] : []
    }),
  ]
  if (!listings.length) return { updated: [], failed: 0, reason: 'catalog-unavailable' }
  const updates = collectPackageUpdates(installed, listings, get(packageOrigins), currentLegacyStores())
    .filter(({ entry }) => options.retryAttempted || !attempted.has(`${entry.id}@${entry.version}`))
  const updated: ExtensionCatalogPackage[] = []
  let failed = 0
  // Sequential on purpose: every install rebuilds the worker set; racing several rebuilds is the
  // exact contention resetRunning exists to avoid.
  for (const { entry, storeUrl } of updates) {
    if (get(playing)) break // playback started mid-check; the unmarked rest retry next tick
    attempted.add(`${entry.id}@${entry.version}`)
    try {
      // The installer records the store the package came from, refuses any other store, and never
      // reinstalls a package removed while this check ran.
      await installCatalogPackage(entry, storeUrl, { updateOnly: true })
      updated.push(entry)
    } catch {
      failed += 1
      // Old version stays installed and keeps working; the latch stops same-session retries.
    }
  }
  if (updated.length === 1) showNotice(`Updated ${updated[0].name} to v${updated[0].version}.`)
  else if (updated.length) showNotice(`Updated ${updated.length} sources.`)
  return { updated, failed }
}

const FIRST_DELAY = 15_000 // after the app-update check's 5s, so boot network isn't all at once
const INTERVAL = 6 * 60 * 60_000 // same cadence as the app updater

/** Delayed launch check + 6h interval, like the app updater. Returns a stop fn. */
export function startExtensionUpdateChecks(): () => void {
  // Freeze which stores may claim packages installed before origins were recorded now, before
  // anything this session can add a catalog to the source list.
  void import('$lib/store/origins').then(({ currentLegacyStores }) => currentLegacyStores()).catch(() => {})
  let interval: ReturnType<typeof setInterval> | null = null
  const first = setTimeout(() => {
    // Catalogs added before stores existed become stores first, so they are checked as stores.
    void import('$lib/store/migrate')
      .then(({ migrateCatalogStores }) => migrateCatalogStores())
      .catch(() => 0)
      .finally(() => { void checkExtensionUpdates() })
    interval = setInterval(() => { void checkExtensionUpdates() }, INTERVAL)
  }, FIRST_DELAY)
  return () => { clearTimeout(first); if (interval) clearInterval(interval) }
}
