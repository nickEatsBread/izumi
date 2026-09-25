import { get } from 'svelte/store'
import { sourceLabel } from '$lib/extensions/catalog'
import { BUILTIN_STORES, addStore, allStores, claimStorePin, storeIdForUrl, type StoreFeed } from './feeds'
import { entryTypeLabel } from './filters'
import { loadStore, type LoadedStore } from './load'
import { decideStoreTrust } from './trust'
import { resolveStoreUrl } from './url'

/** loadStore plus trust on first use. The first verified key a store shows is pinned — only when no
 *  pin exists yet, so two overlapping first loads can never replace each other's pin. */
export async function loadStoreAndPin(store: StoreFeed, options: { force?: boolean } = {}): Promise<LoadedStore> {
  const result = await loadStore(store, options)
  if (result.trust.state !== 'signed' || !result.trust.pin) return result
  if (claimStorePin(store.id, result.trust.pin)) {
    return { ...result, trust: { state: 'signed', fingerprint: result.trust.fingerprint } }
  }
  // Another load pinned a different key first: judge this listing against that pin instead.
  const pinned = get(allStores).find((item) => item.id === store.id)?.pinnedKey
  const trust = decideStoreTrust(pinned, true, result.trust.fingerprint)
  return trust.state === 'locked' ? { ...result, listing: undefined, cached: false, trust } : { ...result, trust }
}

export interface StorePreview {
  url: string
  name: string
  domain: string
  /** Entry counts by type label, in first-seen order. */
  counts: Array<[string, number]>
  signed: boolean
  fingerprint?: string
  skipped: number
}

/** Fetch and summarise a store before it is added. Throws a user-facing message on any problem.
 *  Nothing is saved: a store the user doesn't add leaves no trace. */
export async function previewStore(input: string): Promise<StorePreview> {
  const url = resolveStoreUrl(input)
  if (!url) throw new Error('Enter a public HTTPS link to a store, or a GitHub owner/repo.')
  if (BUILTIN_STORES.some((store) => store.url === url)) throw new Error('That store is already built in.')
  // Canonical URLs on both sides, so no other spelling of an added store gets past this.
  if (get(allStores).some((store) => store.url === url)) throw new Error('That store is already added.')
  const draft: StoreFeed = { id: storeIdForUrl(url), url, name: sourceLabel(url), enabled: true, addedAt: Date.now() }
  const result = await loadStore(draft, { force: true, save: false })
  if (result.trust.state === 'locked') throw new Error("This store's signature doesn't match its key.")
  if (!result.listing) throw new Error(result.error ?? 'The store could not be loaded.')
  const counts = new Map<string, number>()
  for (const entry of result.listing.entries) {
    const label = entryTypeLabel(entry)
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return {
    url,
    name: result.listing.name ?? sourceLabel(url),
    domain: new URL(url).hostname,
    counts: [...counts],
    signed: result.trust.state === 'signed',
    ...(result.trust.state === 'signed' ? { fingerprint: result.trust.fingerprint } : {}),
    skipped: result.listing.skipped,
  }
}

/** Add a previewed store, pinning the key it was previewed with. Installs nothing. */
export function confirmStore(preview: StorePreview): StoreFeed {
  return addStore(preview.url, preview.name, preview.fingerprint)
}
