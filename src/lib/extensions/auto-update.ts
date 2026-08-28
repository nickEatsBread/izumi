import { get, writable } from 'svelte/store'
import { enabledExtensionUrls, extensionUrls } from '$lib/settings/ui'
import { playing } from '$lib/player/session'
import type { ExtensionCatalogPackage } from './catalog'
import type { InstalledExtensionPackage } from './manager'

// Background auto-update for installed .izumi-ext packages. The manual path (the Update button in
// settings → sources) already trusts the catalog's sha-pinned payloads; this runs the same install
// unprompted so a repo release actually reaches people who never revisit that page.

/** One-line "Updated …" notice for the shell pill. Cleared automatically. */
export const extensionUpdateNotice = writable('')
let noticeTimer: ReturnType<typeof setTimeout> | null = null
function showNotice(text: string): void {
  extensionUpdateNotice.set(text)
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => extensionUpdateNotice.set(''), 8000)
}

/** The catalog entries worth installing: version differs from what's on disk. The catalog is
 *  canonical in BOTH directions — a repo rollback must propagate too, so this is `!==`, not a
 *  semver ordering. Installed packages absent from every catalog (local sideloads) are left alone.
 *  When several catalogs list the same id, the first wins, matching the settings list's install
 *  precedence. */
export function collectPackageUpdates(
  installed: InstalledExtensionPackage[],
  catalogs: ExtensionCatalogPackage[][],
): ExtensionCatalogPackage[] {
  const canonical = new Map<string, ExtensionCatalogPackage>()
  for (const list of catalogs) {
    for (const entry of list) {
      if (!canonical.has(entry.id)) canonical.set(entry.id, entry)
    }
  }
  return installed.flatMap((extension) => {
    const entry = canonical.get(extension.id)
    return entry && entry.version !== extension.version ? [entry] : []
  })
}

// If a catalog's `version` field disagrees with the version its package actually installs, the
// mismatch survives the install and every later check would reinstall it forever. Remember what was
// tried this session (id@catalog-version) and never try it twice; a failed install is latched for
// the same reason — hammering a broken download every 6h helps nobody. Cleared by restart.
const attempted = new Set<string>()

export interface ExtensionUpdateCheckResult {
  updated: ExtensionCatalogPackage[]
  failed: number
  reason?: 'playback' | 'no-installed' | 'no-catalogs' | 'catalog-unavailable'
}

export interface ExtensionUpdateCheckOptions {
  retryAttempted?: boolean
  /** A manual check is an explicit request, so it may inspect catalogs the user has disabled for
   *  background polling without changing their enabled state. */
  includeDisabledCatalogs?: boolean
  /** Packages installed from the built-in Store predate catalog provenance in some profiles.
   *  Include the Store catalog directly so those installs can still be checked. */
  includeOfficialCatalog?: boolean
}

/** Compare every installed package against the enabled catalogs and reinstall what changed.
 *  Never throws. Skipped entirely during playback: each install tears down the running worker set
 *  and the JVM runtime, which would kill an in-flight resolve. */
export async function checkExtensionUpdates(
  options: ExtensionUpdateCheckOptions = {},
): Promise<ExtensionUpdateCheckResult> {
  if (get(playing)) return { updated: [], failed: 0, reason: 'playback' }
  // The first check is delayed by 15 seconds; keep the extension manager and worker graph out of
  // the app-layout startup chunk until the check actually runs.
  const {
    fetchExtensionInfo,
    installCatalogPackage,
    installedExtensionPackages,
    OFFICIAL_ANIME_CATALOG,
  } = await import('./manager')
  const installed = await installedExtensionPackages()
  if (!installed.length) return { updated: [], failed: 0, reason: 'no-installed' }
  const configured = get(options.includeDisabledCatalogs ? extensionUrls : enabledExtensionUrls)
  const specs = [...new Set([
    ...configured,
    ...(options.includeOfficialCatalog ? [OFFICIAL_ANIME_CATALOG] : []),
  ])]
  if (!specs.length) return { updated: [], failed: 0, reason: 'no-catalogs' }
  const infos = await Promise.all(specs.map((spec) => fetchExtensionInfo(spec).catch(() => null)))
  if (infos.every((info) => !info)) return { updated: [], failed: 0, reason: 'catalog-unavailable' }
  const updates = collectPackageUpdates(installed, infos.map((info) => info?.packages ?? []))
    .filter((entry) => options.retryAttempted || !attempted.has(`${entry.id}@${entry.version}`))
  const updated: ExtensionCatalogPackage[] = []
  let failed = 0
  // Sequential on purpose: every install rebuilds the worker set; racing several rebuilds is the
  // exact contention resetRunning exists to avoid.
  for (const entry of updates) {
    if (get(playing)) break // playback started mid-check; the unmarked rest retry next tick
    attempted.add(`${entry.id}@${entry.version}`)
    try {
      await installCatalogPackage(entry)
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
  let interval: ReturnType<typeof setInterval> | null = null
  const first = setTimeout(() => {
    void checkExtensionUpdates()
    interval = setInterval(() => { void checkExtensionUpdates() }, INTERVAL)
  }, FIRST_DELAY)
  return () => { clearTimeout(first); if (interval) clearInterval(interval) }
}
