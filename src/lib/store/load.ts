import { invoke } from '@tauri-apps/api/core'
import { phttp } from '$lib/net/http'
import { adaptStoreDocument } from './adapters'
import { MAX_STORE_BYTES } from './native-format'
import { decideStoreTrust, type StoreTrust } from './trust'
import { signatureUrl } from './url'
import type { StoreFeed } from './feeds'
import type { StoreListing } from './types'

// Fetch → adapt → verify → cache for one store (spec §6.1, §6.7). Never throws: a failure falls
// back to the last good copy, and a store with nothing saved reports its error instead.

const CACHE_PREFIX = 'store-listing-cache-v1:'
/** Listings younger than this are served from the saved copy unless a refresh is forced. */
export const STORE_REFRESH_MS = 60 * 60_000

export interface LoadedStore {
  store: StoreFeed
  listing?: StoreListing
  trust: StoreTrust
  fetchedAt: number
  /** True when the listing came from the saved copy. */
  cached: boolean
  error?: string
}

export interface StoreLoadDeps {
  fetchText: (url: string) => Promise<string>
  /** Resolves to the key fingerprint when the signature verifies; rejects otherwise. */
  verify: (body: string, signature: string, publicKey: string) => Promise<string>
  now: () => number
  cache: Pick<Storage, 'getItem' | 'setItem'>
}

const memoryCache = new Map<string, string>()
const defaultDeps: StoreLoadDeps = {
  async fetchText(url) {
    const response = await phttp(url, { maxBytes: MAX_STORE_BYTES, timeoutMs: 20_000, background: true })
    if (!response.ok) throw new Error(`The store returned HTTP ${response.status}.`)
    return response.text()
  },
  verify: (body, signature, publicKey) => invoke<string>('store_verify_index', { body, signature, publicKey }),
  now: () => Date.now(),
  cache: {
    getItem: (key) => (typeof localStorage === 'undefined' ? memoryCache.get(key) ?? null : localStorage.getItem(key)),
    setItem: (key, value) => {
      if (typeof localStorage === 'undefined') memoryCache.set(key, value)
      else localStorage.setItem(key, value)
    },
  },
}

interface SavedStore {
  url: string
  listing: StoreListing
  trust: StoreTrust
  fetchedAt: number
}

function readSaved(deps: StoreLoadDeps, store: StoreFeed): SavedStore | null {
  try {
    const saved = JSON.parse(deps.cache.getItem(CACHE_PREFIX + store.id) ?? 'null') as SavedStore | null
    return saved && saved.url === store.url && Array.isArray(saved.listing?.entries) ? saved : null
  } catch {
    return null
  }
}

function writeSaved(deps: StoreLoadDeps, store: StoreFeed, value: Omit<SavedStore, 'url'>): void {
  try {
    deps.cache.setItem(CACHE_PREFIX + store.id, JSON.stringify({ url: store.url, ...value }))
  } catch {
    // Storage full: browsing still works; the store is simply refetched next time.
  }
}

/** A saved listing was verified when fetched; re-judge it against the store's current pin. */
function savedTrust(saved: SavedStore, store: StoreFeed): StoreTrust {
  if (saved.trust.state === 'signed') return decideStoreTrust(store.pinnedKey, true, saved.trust.fingerprint)
  if (saved.trust.state === 'unsigned') return decideStoreTrust(store.pinnedKey, false, null)
  return saved.trust
}

export async function loadStore(
  store: StoreFeed,
  options: { force?: boolean } = {},
  deps: StoreLoadDeps = defaultDeps,
): Promise<LoadedStore> {
  const saved = readSaved(deps, store)
  if (saved && !options.force && deps.now() - saved.fetchedAt < STORE_REFRESH_MS) {
    return { store, listing: saved.listing, trust: savedTrust(saved, store), fetchedAt: saved.fetchedAt, cached: true }
  }
  try {
    const body = await deps.fetchText(store.url)
    let raw: unknown
    try {
      raw = JSON.parse(body)
    } catch {
      throw new Error('That link did not return JSON.')
    }
    const listing = adaptStoreDocument(raw, store.url, store.id)
    let verified: string | null = null
    if (listing.publicKey) {
      try {
        const signature = await deps.fetchText(signatureUrl(store.url))
        verified = await deps.verify(body, signature.trim(), listing.publicKey)
      } catch {
        verified = null
      }
    }
    const trust = decideStoreTrust(store.pinnedKey, !!listing.publicKey, verified)
    const fetchedAt = deps.now()
    // A locked listing is never saved, so the next load re-verifies instead of trusting a copy.
    if (trust.state !== 'locked') writeSaved(deps, store, { listing, trust, fetchedAt })
    return { store, listing, trust, fetchedAt, cached: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The store could not be loaded.'
    if (saved) {
      return { store, listing: saved.listing, trust: savedTrust(saved, store), fetchedAt: saved.fetchedAt, cached: true, error: message }
    }
    return { store, trust: { state: 'unsigned' }, fetchedAt: 0, cached: false, error: message }
  }
}
