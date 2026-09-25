import { persisted } from 'svelte-persisted-store'
import { derived, get } from 'svelte/store'
import { OFFICIAL_ANIME_CATALOG, sourceLabel } from '$lib/extensions/catalog'
import { THEME_CATALOG_URL } from '$lib/themes/packages'
import { ADDON_DIRECTORY_ID } from './types'
import { canonicalStoreUrl } from './url'
import { forgetStoreListing } from './listing-cache'

// The stores the Store browses (spec §6.1). Built-in stores are defined here and can be hidden but
// not deleted. The user's store list syncs between devices through the device snapshot; key pins
// never sync — trusting a store's key is each device's own decision. Adding a store installs nothing.

export interface StoreFeed {
  id: string
  url: string
  name: string
  enabled: boolean
  addedAt: number
  /** Hex SHA-256 fingerprint of the Ed25519 key this store must sign with: compiled into the app for
   *  a built-in store once izumi publishes one, otherwise pinned on this device on first use. */
  pinnedKey?: string
  builtin?: boolean
}

/** izumi's own stores. They list; they never install anything by themselves. */
export const BUILTIN_STORES: readonly StoreFeed[] = [
  { id: 'izumi-packages', url: OFFICIAL_ANIME_CATALOG, name: 'izumi packages', enabled: true, addedAt: 0, builtin: true },
  { id: 'izumi-themes', url: THEME_CATALOG_URL, name: 'izumi themes', enabled: true, addedAt: 0, builtin: true },
]
export const MAX_USER_STORES = 50

const FINGERPRINT = /^[a-f0-9]{64}$/
const BUILTIN_IDS: readonly string[] = [...BUILTIN_STORES.map((store) => store.id), ADDON_DIRECTORY_ID]
/** Names only izumi's own stores use (the built-in chip reads "izumi"), so a user store can't pass
 *  itself off as one of them. */
const RESERVED_NAMES = new Set(['izumi', ...BUILTIN_STORES.map((store) => store.name), 'Addon directory'].map((name) => name.toLowerCase()))

/** A store's display name: invisible characters dropped, whitespace collapsed, at most 64 characters,
 *  and never one of izumi's own names — those fall back to the store's host. */
export function storeName(value: unknown, url: string): string {
  const name = typeof value === 'string'
    ? value.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\s+/g, ' ').trim().slice(0, 64)
    : ''
  return name && !RESERVED_NAMES.has(name.toLowerCase()) ? name : sourceLabel(url)
}

/** Stable id for a user store: two independent 32-bit FNV-style hashes of its canonical URL. */
export function storeIdForUrl(url: string): string {
  let a = 0x811c9dc5
  let b = 0x9e3779b9
  for (let index = 0; index < url.length; index++) {
    const code = url.charCodeAt(index)
    a = Math.imul(a ^ code, 0x01000193) >>> 0
    b = Math.imul(b ^ code, 0x85ebca6b) >>> 0
  }
  return `u-${a.toString(36).padStart(7, '0')}${b.toString(36).padStart(7, '0')}`
}

/** Clean a saved, synced or restored store list: canonical public HTTPS URLs, ids recomputed from
 *  them, duplicates and built-in copies dropped, at most MAX_USER_STORES. Pins are never read here. */
export function normalizeStoreFeeds(value: unknown): StoreFeed[] {
  if (!Array.isArray(value)) return []
  const out: StoreFeed[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (out.length >= MAX_USER_STORES) break
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const url = typeof item.url === 'string' ? canonicalStoreUrl(item.url) : null
    if (!url || BUILTIN_STORES.some((store) => store.url === url)) continue
    const id = storeIdForUrl(url)
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      url,
      name: storeName(item.name, url),
      enabled: item.enabled !== false,
      addedAt: typeof item.addedAt === 'number' && Number.isFinite(item.addedAt) ? item.addedAt : 0,
    })
  }
  return out
}

export function normalizeHiddenBuiltins(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && BUILTIN_IDS.includes(id)))]
}

export function normalizeStorePins(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, string] => /^(?:u-[a-z0-9]{14}|izumi-[a-z]+)$/.test(entry[0])
      && typeof entry[1] === 'string' && FINGERPRINT.test(entry[1])))
}

export const userStores = persisted<StoreFeed[]>('store-feeds-v1', [], { beforeRead: normalizeStoreFeeds })
/** Built-in stores the user hid (including the addon directory). */
export const hiddenBuiltinStores = persisted<string[]>('store-hidden-builtins-v1', [], { beforeRead: normalizeHiddenBuiltins })
/** Key fingerprints pinned on this device (store id → fingerprint). Never synced. */
export const storePins = persisted<Record<string, string>>('store-pins-v1', {}, { beforeRead: normalizeStorePins })

export const directoryEnabled = derived(hiddenBuiltinStores, ($hidden) => !normalizeHiddenBuiltins($hidden).includes(ADDON_DIRECTORY_ID))

// Normalised again on every read: synced or restored values reach these stores through set(), which
// skips beforeRead, so this derived view is the one place every value is guaranteed clean.
export const allStores = derived(
  [userStores, hiddenBuiltinStores, storePins],
  ([$user, $hidden, $pins]): StoreFeed[] => {
    const hidden = normalizeHiddenBuiltins($hidden)
    const pins = normalizeStorePins($pins)
    return [
      ...BUILTIN_STORES.map((store) => {
        // A key compiled into the app always wins over a pin made on this device.
        const pinnedKey = store.pinnedKey ?? pins[store.id]
        return { ...store, enabled: !hidden.includes(store.id), ...(pinnedKey ? { pinnedKey } : {}) }
      }),
      ...normalizeStoreFeeds($user).map((store) => (pins[store.id] ? { ...store, pinnedKey: pins[store.id] } : store)),
    ]
  },
)
export const enabledStores = derived(allStores, ($stores) => $stores.filter((store) => store.enabled))

/** Add a user store. Refuses an existing store outright, so adding never re-pins, re-enables or
 *  replaces anything. The optional fingerprint is the key the store was previewed with. */
export function addStore(url: string, name: string, pinnedKey?: string): StoreFeed {
  const canonical = canonicalStoreUrl(url)
  if (!canonical) throw new Error('Stores must be public HTTPS links.')
  if (BUILTIN_STORES.some((store) => store.url === canonical)) throw new Error('That store is already built in.')
  if (pinnedKey !== undefined && !FINGERPRINT.test(pinnedKey)) throw new Error('Invalid key fingerprint.')
  const current = normalizeStoreFeeds(get(userStores))
  const id = storeIdForUrl(canonical)
  if (current.some((store) => store.id === id || store.url === canonical)) throw new Error('That store is already added.')
  if (current.length >= MAX_USER_STORES) throw new Error(`You can add up to ${MAX_USER_STORES} stores.`)
  const [feed] = normalizeStoreFeeds([{ url: canonical, name, enabled: true, addedAt: Date.now() }])
  userStores.set([...current, feed])
  storePins.update((pins) => {
    const next = normalizeStorePins(pins)
    // Trust starts over for a newly added store: a pin left by an earlier copy never carries over.
    if (pinnedKey) next[feed.id] = pinnedKey
    else delete next[feed.id]
    return next
  })
  return pinnedKey ? { ...feed, pinnedKey } : feed
}

export function removeStore(id: string): void {
  userStores.update((stores) => normalizeStoreFeeds(stores).filter((store) => store.id !== id))
  storePins.update((pins) => {
    const next = normalizeStorePins(pins)
    delete next[id]
    return next
  })
  forgetStoreListing(id)
}

export function setStoreEnabled(id: string, enabled: boolean): void {
  if (BUILTIN_IDS.includes(id)) {
    hiddenBuiltinStores.update((hidden) => {
      const current = normalizeHiddenBuiltins(hidden)
      return enabled ? current.filter((item) => item !== id) : [...new Set([...current, id])]
    })
    return
  }
  userStores.update((stores) => normalizeStoreFeeds(stores).map((store) => (store.id === id ? { ...store, enabled } : store)))
}

/** Pin (or, with undefined, clear) the key fingerprint a store must keep signing with, on this
 *  device. A key izumi compiled in for a built-in store can't be replaced from here. */
export function pinStoreKey(id: string, fingerprint: string | undefined): void {
  if (fingerprint !== undefined && !FINGERPRINT.test(fingerprint)) throw new Error('Invalid key fingerprint.')
  if (BUILTIN_STORES.find((store) => store.id === id)?.pinnedKey) {
    throw new Error("izumi fixes this store's signing key; it can't be re-trusted here.")
  }
  storePins.update((pins) => {
    const next = normalizeStorePins(pins)
    if (fingerprint) next[id] = fingerprint
    else delete next[id]
    return next
  })
}

/** Trust on first use, safely: pins the fingerprint only when the store has no pin yet. Returns
 *  whether the store is now pinned to exactly this fingerprint, so an overlapping load can never
 *  replace a pin another load just made. */
export function claimStorePin(id: string, fingerprint: string): boolean {
  if (!FINGERPRINT.test(fingerprint)) return false
  const compiled = BUILTIN_STORES.find((store) => store.id === id)?.pinnedKey
  if (compiled) return compiled === fingerprint
  const pins = normalizeStorePins(get(storePins))
  if (pins[id]) return pins[id] === fingerprint
  storePins.set({ ...pins, [id]: fingerprint })
  return true
}

/** Drop pins of stores that are no longer listed (for example after a synced list removed them). */
export function pruneStorePins(): void {
  const keep = new Set([...BUILTIN_STORES.map((store) => store.id), ...normalizeStoreFeeds(get(userStores)).map((store) => store.id)])
  storePins.update((pins) => Object.fromEntries(Object.entries(normalizeStorePins(pins)).filter(([id]) => keep.has(id))))
}

/** Register a package catalog the user pasted into Sources as a store too, so it appears in the
 *  Store. Returns false when it was already known, is built in, isn't a public HTTPS link, or is a
 *  GitHub page (HTML, never the catalog itself — such a source stays a source). */
export function registerCatalogStore(url: string): boolean {
  const canonical = canonicalStoreUrl(url)
  if (!canonical || /^https:\/\/(?:www\.)?github\.com\//i.test(canonical)) return false
  try {
    addStore(canonical, sourceLabel(canonical))
    return true
  } catch {
    return false
  }
}
