import { invoke } from '@tauri-apps/api/core'
import { phttp } from '$lib/net/http'
import { adaptStoreDocument } from './adapters'
import { listingCache } from './listing-cache'
import { MAX_STORE_BYTES } from './native-format'
import { decideStoreTrust, type StoreTrust } from './trust'
import { signatureUrl } from './url'
import type { StoreFeed } from './feeds'
import type { StoreListing } from './types'

// Fetch → adapt → verify → save for one store (spec §6.1, §6.7). Never throws. A listing that fails
// its key check is never shown or saved; the last copy that passed stays in use instead.

/** Listings younger than this are served from the saved copy unless a refresh is forced. */
export const STORE_REFRESH_MS = 60 * 60_000
const MAX_SIGNATURE_BYTES = 4_096

/** A non-2xx answer, told apart from transport failures: a missing signature file fails the key
 *  check, while a network error only means the store couldn't be reached this time. */
export class StoreHttpError extends Error {
  constructor(readonly status: number) {
    super(`The store returned HTTP ${status}.`)
  }
}

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
  fetchText: (url: string, maxBytes: number) => Promise<string>
  /** Resolves to the key fingerprint when the signature verifies; rejects otherwise. */
  verify: (body: string, signature: string, publicKey: string) => Promise<string>
  now: () => number
  cache: {
    get: (storeId: string) => Promise<string | undefined>
    set: (storeId: string, value: string) => Promise<void>
  }
}

const defaultDeps: StoreLoadDeps = {
  async fetchText(url, maxBytes) {
    const response = await phttp(url, { maxBytes, timeoutMs: 20_000, background: true })
    if (!response.ok) throw new StoreHttpError(response.status)
    return response.text()
  },
  verify: (body, signature, publicKey) => invoke<string>('store_verify_index', { body, signature, publicKey }),
  now: () => Date.now(),
  cache: listingCache,
}

interface SavedStore {
  url: string
  listing: StoreListing
  trust: StoreTrust
  fetchedAt: number
}

async function readSaved(deps: StoreLoadDeps, store: StoreFeed): Promise<SavedStore | null> {
  try {
    const saved = JSON.parse((await deps.cache.get(store.id)) ?? 'null') as SavedStore | null
    return saved && saved.url === store.url && Array.isArray(saved.listing?.entries)
      && typeof saved.fetchedAt === 'number' && typeof saved.trust?.state === 'string' ? saved : null
  } catch {
    return null
  }
}

async function writeSaved(deps: StoreLoadDeps, store: StoreFeed, value: Omit<SavedStore, 'url'>): Promise<void> {
  try {
    await deps.cache.set(store.id, JSON.stringify({ url: store.url, ...value }))
  } catch {
    // Storage unavailable: browsing still works; the store is simply refetched next time.
  }
}

/** A saved listing was verified when fetched; judge it again against the store's current pin. A saved
 *  copy never pins a key — trust on first use comes from a live fetch only — so clearing a pin
 *  ("Trust without a key") can't be undone by an old signed copy. */
function savedTrust(saved: SavedStore, store: StoreFeed): StoreTrust {
  if (saved.trust.state === 'signed') {
    const trust = decideStoreTrust(store.pinnedKey, true, saved.trust.fingerprint)
    return trust.state === 'signed' ? { state: 'signed', fingerprint: trust.fingerprint } : trust
  }
  if (saved.trust.state === 'unsigned') return decideStoreTrust(store.pinnedKey, false, null)
  return saved.trust
}

export async function loadStore(
  store: StoreFeed,
  options: { force?: boolean; save?: boolean } = {},
  deps: StoreLoadDeps = defaultDeps,
): Promise<LoadedStore> {
  const saved = await readSaved(deps, store)
  // Only a copy that still passes against today's pin is ever used.
  const passing = saved && savedTrust(saved, store).state !== 'locked' ? saved : null
  const now = deps.now()
  if (passing && !options.force && passing.fetchedAt <= now && now - passing.fetchedAt < STORE_REFRESH_MS) {
    return { store, listing: passing.listing, trust: savedTrust(passing, store), fetchedAt: passing.fetchedAt, cached: true }
  }
  try {
    const body = await deps.fetchText(store.url, MAX_STORE_BYTES)
    let raw: unknown
    try {
      raw = JSON.parse(body)
    } catch {
      throw new Error('That link did not return JSON.')
    }
    const listing = adaptStoreDocument(raw, store.url, store.id)
    let verified: string | null = null
    if (listing.publicKey) {
      let signature: string | null = null
      try {
        signature = await deps.fetchText(signatureUrl(store.url), MAX_SIGNATURE_BYTES)
      } catch (error) {
        // A store that declares a key but has no signature file fails the check; any other failure
        // only means the signature couldn't be fetched this time.
        if (!(error instanceof StoreHttpError && (error.status === 404 || error.status === 410))) throw error
      }
      if (signature !== null) verified = await deps.verify(body, signature.trim(), listing.publicKey).catch(() => null)
    }
    const trust = decideStoreTrust(store.pinnedKey, !!listing.publicKey, verified)
    const fetchedAt = deps.now()
    if (trust.state === 'locked') {
      return { store, listing: passing?.listing, trust, fetchedAt: passing?.fetchedAt ?? fetchedAt, cached: !!passing }
    }
    if (options.save !== false) await writeSaved(deps, store, { listing, trust, fetchedAt })
    return { store, listing, trust, fetchedAt, cached: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The store could not be loaded.'
    if (passing) {
      return { store, listing: passing.listing, trust: savedTrust(passing, store), fetchedAt: passing.fetchedAt, cached: true, error: message }
    }
    return { store, trust: { state: 'unsigned' }, fetchedAt: 0, cached: false, error: message }
  }
}
