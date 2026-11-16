import { get } from 'svelte/store'
import { enabledStores, type StoreFeed } from './feeds'
import { loadStoreAndPin } from './service'
import type { LoadedStore } from './load'
import type { StoreEntry } from './types'

/** One kind of entry from every enabled store, each tied to the store it came from (`pick` returns
 *  undefined for the rest). A store whose signing-key check failed lists nothing until the user
 *  reviews it under Manage stores. */
export async function loadListings<T>(
  pick: (entry: StoreEntry, store: StoreFeed) => T | undefined,
  noun: string,
  options: { force?: boolean } = {},
): Promise<{ listings: T[]; cached: boolean; errors: string[]; loaded: Record<string, LoadedStore> }> {
  const results = await Promise.all(get(enabledStores).map((store) => loadStoreAndPin(store, options)))
  // Every store's load result by id, for the store manager the page opens.
  const loaded = Object.fromEntries(results.map((result) => [result.store.id, result]))
  const listings: T[] = []
  const errors: string[] = []
  let cached = false
  for (const result of results) {
    if (result.error) {
      errors.push(`${result.store.name}: ${result.error}`)
      if (result.listing) cached = true
    }
    if (result.trust.state === 'locked') {
      errors.push(`${result.store.name}: its signing-key check failed, so its ${noun} are hidden until you review it under Manage stores.`)
      continue
    }
    for (const entry of result.listing?.entries ?? []) {
      const listing = pick(entry, result.store)
      if (listing !== undefined) listings.push(listing)
    }
  }
  return { listings, cached, errors, loaded }
}
