import { persisted } from 'svelte-persisted-store'
import { get } from 'svelte/store'
import { OFFICIAL_ANIME_CATALOG } from '$lib/extensions/catalog'
import { extensionUrls } from '$lib/settings/ui'
import { canonicalStoreUrl } from './url'

/** Which store each installed package came from (package id → store URL). An installed package only
 *  ever changes through this store — a same-id package elsewhere is a takeover, not an update. */
export const packageOrigins = persisted<Record<string, string>>('package-origins-v1', {})

/** The stores a package installed before origins were recorded may have come from: the official
 *  catalog and the source list's catalogs, frozen the first time this version needed them. No store
 *  added afterwards — including one a Store install puts in the source list — can ever claim those
 *  packages. Null until frozen. */
export const legacyPackageStores = persisted<string[] | null>('package-legacy-stores-v1', null)

/** How stores and source-list specs are compared: the canonical URL when there is one, else as written. */
export function originKey(spec: string): string {
  return canonicalStoreUrl(spec) ?? spec
}

/** The frozen legacy stores still in effect: the official catalog, and catalogs still in the source
 *  list — removing a catalog from Sources ends its claim. */
export function legacyStoresFrom(frozen: readonly string[] | null | undefined, sourceSpecs: readonly string[]): string[] {
  if (!Array.isArray(frozen)) return []
  const current = new Set([originKey(OFFICIAL_ANIME_CATALOG), ...sourceSpecs.map(originKey)])
  return frozen.filter((url) => current.has(url))
}

/** Freeze the legacy stores if that hasn't happened yet, and return the ones still in effect. */
export function currentLegacyStores(): string[] {
  let frozen = get(legacyPackageStores)
  if (!Array.isArray(frozen)) {
    frozen = [...new Set([OFFICIAL_ANIME_CATALOG, ...get(extensionUrls)].map(originKey))]
    legacyPackageStores.set(frozen)
  }
  return legacyStoresFrom(frozen, get(extensionUrls))
}

/** Whether an installed package may be replaced from this store: only from the store it came from,
 *  or — installed before origins were recorded — from one of the legacy stores, and then only by the
 *  same kind of package, so a legacy claim can never turn a package into native code. */
export function mayReplacePackage(id: string, storeUrl: string, sameBackend = true): boolean {
  const origins = get(packageOrigins)
  const key = originKey(storeUrl)
  if (Object.hasOwn(origins, id)) return origins[id] === key
  return sameBackend && currentLegacyStores().includes(key)
}

export function recordPackageOrigin(id: string, storeUrl: string): void {
  packageOrigins.update((origins) => ({ ...origins, [id]: originKey(storeUrl) }))
}

export function forgetPackageOrigin(id: string): void {
  packageOrigins.update((origins) => {
    const next = { ...origins }
    delete next[id]
    return next
  })
}
