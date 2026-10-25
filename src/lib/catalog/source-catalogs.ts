/** Source catalogs: a local-service source whose `index.json` names `catalog` (a Stremio addon
 *  manifest it serves) gets its own catalog screen, `source:<packageId>`. The service runs on a
 *  loopback port that changes between launches, so its identity is the package id, never the URL:
 *  titles, history and lists keep working across restarts. */
import { persisted } from 'svelte-persisted-store'
import { get } from 'svelte/store'
import { phttp } from '$lib/net/http'
import type { AddonCatalog, AddonManifest } from '$lib/stremio/manifest'
import { disabledPlugins } from '$lib/settings/ui'

export type SourceSelection = `source:${string}`

export interface SourceCatalogInfo {
  packageId: string
  name: string
  /** The manifest's https logo, for the screen's tile. */
  logo?: string
}

/** A manifest catalog with izumi's optional role hints. */
export type SourceCatalogEntry = AddonCatalog & { izumi?: { hero?: boolean; continue?: boolean } }

export interface SourceAddon {
  packageId: string
  /** Live base, `http://127.0.0.1:<port>/…` without `/manifest.json`. */
  base: string
  /** Stable addon origin id used in title identities. */
  originId: string
  manifest: AddonManifest
}

const PACKAGE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/i

/** Source catalogs seen on this device, for labels and the screen list before a service starts. */
export const sourceCatalogs = persisted<SourceCatalogInfo[]>('source-catalogs-v1', [], {
  beforeRead: (value) => (Array.isArray(value)
    ? value.filter((item): item is SourceCatalogInfo => !!item && typeof item.packageId === 'string' && PACKAGE_ID.test(item.packageId) && typeof item.name === 'string'
      && (item.logo === undefined || (typeof item.logo === 'string' && item.logo.startsWith('https://'))))
    : []),
})

export const sourceSelection = (packageId: string): SourceSelection => `source:${packageId}`
export const isSourceSelection = (value: unknown): value is SourceSelection =>
  typeof value === 'string' && value.startsWith('source:') && PACKAGE_ID.test(value.slice(7))
export const sourcePackageOf = (selection: SourceSelection): string => selection.slice(7)
export const sourceOriginId = (packageId: string): string => `source-${packageId}`
export const isSourceOrigin = (originId: string | undefined): boolean => !!originId?.startsWith('source-')

/** A source screen exists while its package is known here and not switched off. */
export function knownSourceSelection(value: unknown): value is SourceSelection {
  if (!isSourceSelection(value)) return false
  const packageId = sourcePackageOf(value)
  return get(sourceCatalogs).some((item) => item.packageId === packageId) && !get(disabledPlugins).includes(packageId)
}

const infoOf = (packageId: string, manifest: AddonManifest, fallback: string): SourceCatalogInfo => ({
  packageId,
  name: manifest.name || fallback,
  ...(typeof manifest.logo === 'string' && manifest.logo.startsWith('https://') ? { logo: manifest.logo } : {}),
})

export const sourceCatalogLogo = (selection: SourceSelection): string | undefined =>
  get(sourceCatalogs).find((item) => item.packageId === sourcePackageOf(selection))?.logo

export function sourceCatalogName(selection: SourceSelection): string {
  const packageId = sourcePackageOf(selection)
  return get(sourceCatalogs).find((item) => item.packageId === packageId)?.name ?? 'Source'
}

// Live bases by package and by base, so the Stremio provider can map either way. A manifest is
// re-read after a minute: its rows change once the viewer signs in to the source.
const MANIFEST_TTL_MS = 60_000
const live = new Map<string, { job: Promise<SourceAddon>; at: number }>()
const byBase = new Map<string, string>()

/** The origin id for a base the Stremio provider is about to tag titles with. */
export function sourceOriginForBase(base: string): string | undefined {
  const packageId = byBase.get(base.replace(/\/+$/, ''))
  return packageId ? sourceOriginId(packageId) : undefined
}

export function isSourceBase(base: string): boolean {
  return byBase.has(base.replace(/\/+$/, ''))
}

async function json<T>(url: string): Promise<T> {
  const response = await phttp(url, { timeoutMs: 20_000, maxBytes: 4 * 1024 * 1024 })
  if (!response.ok) throw new Error(`The source answered HTTP ${response.status}.`)
  return response.json() as Promise<T>
}

/** Starts the source's service if needed and reads its catalog manifest. */
export function sourceAddon(packageId: string): Promise<SourceAddon> {
  const existing = live.get(packageId)
  if (existing && Date.now() - existing.at < MANIFEST_TTL_MS) return existing.job
  const job = (async () => {
    const { ensureExtensionService } = await import('$lib/extensions/manager')
    const indexUrl = await ensureExtensionService(packageId)
    const index = await json<{ catalog?: unknown; name?: unknown }>(indexUrl)
    if (typeof index.catalog !== 'string' || !index.catalog.startsWith('/') || index.catalog.includes('..')) {
      throw new Error('This source has no catalog.')
    }
    const manifestUrl = new URL(index.catalog, indexUrl)
    if (manifestUrl.origin !== new URL(indexUrl).origin) throw new Error('This source names a catalog elsewhere.')
    const manifest = await json<AddonManifest>(manifestUrl.href)
    const base = manifestUrl.href.replace(/\/manifest\.json$/, '')
    byBase.set(base, packageId)
    return { packageId, base, originId: sourceOriginId(packageId), manifest }
  })()
  live.set(packageId, { job, at: Date.now() })
  // A failure or a restarted service (new port) must not stick for the session.
  job.catch(() => { if (live.get(packageId)?.job === job) live.delete(packageId) })
  return job
}

/** Forget a source's live base (its service restarted or was removed). */
export function forgetSourceAddon(packageId: string): void {
  live.delete(packageId)
  for (const [base, id] of byBase) if (id === packageId) byBase.delete(base)
}

export async function sourceAddonForOrigin(originId: string): Promise<SourceAddon | undefined> {
  if (!isSourceOrigin(originId)) return undefined
  return sourceAddon(originId.slice('source-'.length)).catch(() => undefined)
}

/** Looks at every installed local-service package and records the ones that serve a catalog.
 *  Returns the catalogs found. Starting a service is what reading its index takes. */
export async function discoverSourceCatalogs(): Promise<SourceCatalogInfo[]> {
  const { installedExtensionPackages } = await import('$lib/extensions/manager')
  const services = (await installedExtensionPackages()).filter((pkg) => pkg.backend === 'izumi-service')
  const found = await Promise.all(services.map(async (pkg) => {
    try {
      const addon = await sourceAddon(pkg.id)
      return infoOf(pkg.id, addon.manifest, pkg.name)
    } catch {
      return null
    }
  }))
  const catalogs = found.filter((item): item is SourceCatalogInfo => !!item)
  sourceCatalogs.set(catalogs)
  return catalogs
}

/** Records one source catalog right away (a pack just installed it). */
export async function registerSourceCatalog(packageId: string): Promise<SourceCatalogInfo> {
  const addon = await sourceAddon(packageId)
  const info = infoOf(packageId, addon.manifest, packageId)
  sourceCatalogs.update((list) => [...list.filter((item) => item.packageId !== packageId), info])
  return info
}

export function unregisterSourceCatalog(packageId: string): void {
  forgetSourceAddon(packageId)
  sourceCatalogs.update((list) => list.filter((item) => item.packageId !== packageId))
}

/** The catalog a source marks as its featured hero / its Continue Watching. */
export const heroCatalogOf = (manifest: AddonManifest): SourceCatalogEntry | undefined =>
  (manifest.catalogs as SourceCatalogEntry[] | undefined)?.find((entry) => entry.izumi?.hero)
export const continueCatalogOf = (manifest: AddonManifest): SourceCatalogEntry | undefined =>
  (manifest.catalogs as SourceCatalogEntry[] | undefined)?.find((entry) => entry.izumi?.continue)
