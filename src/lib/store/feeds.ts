import { persisted } from 'svelte-persisted-store'
import { derived, get } from 'svelte/store'
import { OFFICIAL_ANIME_CATALOG, sourceLabel } from '$lib/extensions/catalog'
import { THEME_CATALOG_URL } from '$lib/themes/packages'
import { ADDON_DIRECTORY_ID } from './types'

// The stores the Store browses (spec §6.1). Built-in stores are defined here and can be hidden but
// not deleted; user stores are persisted and sync between devices. Adding a store installs nothing.

export interface StoreFeed {
  id: string
  url: string
  name: string
  enabled: boolean
  addedAt: number
  /** Hex SHA-256 fingerprint of the store's Ed25519 key, pinned the first time it was seen. */
  pinnedKey?: string
  builtin?: boolean
}

/** izumi's own stores. They list; they never install anything by themselves. */
export const BUILTIN_STORES: readonly StoreFeed[] = [
  { id: 'izumi-packages', url: OFFICIAL_ANIME_CATALOG, name: 'izumi packages', enabled: true, addedAt: 0, builtin: true },
  { id: 'izumi-themes', url: THEME_CATALOG_URL, name: 'izumi themes', enabled: true, addedAt: 0, builtin: true },
]

const FINGERPRINT = /^[a-f0-9]{64}$/
const isBuiltinId = (id: string) => id === ADDON_DIRECTORY_ID || BUILTIN_STORES.some((store) => store.id === id)

/** Stable id for a user store, derived from its URL (FNV-1a). */
export function storeIdForUrl(url: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < url.length; index++) {
    hash ^= url.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `u-${hash.toString(36)}`
}

export function normalizeStoreFeeds(value: unknown): StoreFeed[] {
  if (!Array.isArray(value)) return []
  const out: StoreFeed[] = []
  const seen = new Set<string>()
  for (const raw of value.slice(0, 50)) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    if (typeof item.url !== 'string') continue
    let url: URL
    try {
      url = new URL(item.url)
    } catch {
      continue
    }
    if (url.protocol !== 'https:' || url.username || url.password) continue
    const id = storeIdForUrl(url.href)
    if (seen.has(id) || BUILTIN_STORES.some((store) => store.url === url.href)) continue
    seen.add(id)
    out.push({
      id,
      url: url.href,
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 64) : sourceLabel(url.href),
      enabled: item.enabled !== false,
      addedAt: typeof item.addedAt === 'number' ? item.addedAt : 0,
      ...(typeof item.pinnedKey === 'string' && FINGERPRINT.test(item.pinnedKey) ? { pinnedKey: item.pinnedKey } : {}),
    })
  }
  return out
}

export const userStores = persisted<StoreFeed[]>('store-feeds-v1', [], { beforeRead: normalizeStoreFeeds })
/** Built-in stores the user hid (including the addon directory). */
export const hiddenBuiltinStores = persisted<string[]>('store-hidden-builtins-v1', [])
/** Keys pinned for built-in stores, kept apart from the compiled list. */
export const builtinStorePins = persisted<Record<string, string>>('store-builtin-pins-v1', {})

export const directoryEnabled = derived(hiddenBuiltinStores, ($hidden) => !$hidden.includes(ADDON_DIRECTORY_ID))

export const allStores = derived(
  [userStores, hiddenBuiltinStores, builtinStorePins],
  ([$user, $hidden, $pins]): StoreFeed[] => [
    ...BUILTIN_STORES.map((store) => ({
      ...store,
      enabled: !$hidden.includes(store.id),
      ...(FINGERPRINT.test($pins[store.id] ?? '') ? { pinnedKey: $pins[store.id] } : {}),
    })),
    ...$user,
  ],
)
export const enabledStores = derived(allStores, ($stores) => $stores.filter((store) => store.enabled))

export function addStore(url: string, name: string, pinnedKey?: string): StoreFeed {
  const [feed] = normalizeStoreFeeds([{ url, name, enabled: true, addedAt: Date.now(), pinnedKey }])
  if (!feed) throw new Error('Stores must be public HTTPS links, and built-in stores are already listed.')
  userStores.update((stores) => [...stores.filter((store) => store.id !== feed.id), feed])
  return feed
}

export function removeStore(id: string): void {
  userStores.update((stores) => stores.filter((store) => store.id !== id))
}

export function setStoreEnabled(id: string, enabled: boolean): void {
  if (isBuiltinId(id)) {
    hiddenBuiltinStores.update((hidden) => enabled ? hidden.filter((item) => item !== id) : [...new Set([...hidden, id])])
    return
  }
  userStores.update((stores) => stores.map((store) => store.id === id ? { ...store, enabled } : store))
}

/** Pin (or, with undefined, clear) the key fingerprint a store must keep signing with. */
export function pinStoreKey(id: string, fingerprint: string | undefined): void {
  if (fingerprint !== undefined && !FINGERPRINT.test(fingerprint)) throw new Error('Invalid key fingerprint.')
  if (BUILTIN_STORES.some((store) => store.id === id)) {
    builtinStorePins.update((pins) => {
      const next = { ...pins }
      if (fingerprint) next[id] = fingerprint
      else delete next[id]
      return next
    })
    return
  }
  userStores.update((stores) => stores.map((store) => {
    if (store.id !== id) return store
    const { pinnedKey: _previous, ...rest } = store
    return fingerprint ? { ...rest, pinnedKey: fingerprint } : rest
  }))
}

/** Register a package catalog the user pasted into Sources as a store too, so it appears in the
 *  Store. Returns false when it was already known, is built in, or isn't an HTTPS link. */
export function registerCatalogStore(url: string): boolean {
  let href: string
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    href = parsed.href
  } catch {
    return false
  }
  if (BUILTIN_STORES.some((store) => store.url === href) || get(userStores).some((store) => store.url === href)) return false
  addStore(href, sourceLabel(href))
  return true
}
