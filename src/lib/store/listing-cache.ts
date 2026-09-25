import { createStore, del, get, set } from 'idb-keyval'

// Saved store listings live in IndexedDB, not localStorage: a listing can be up to 2 MB, and a full
// localStorage would silently stop saving settings — store key pins included.
const PREFIX = 'store-listing-v1:'
let database: ReturnType<typeof createStore> | undefined
const listings = () => (database ??= createStore('izumi-store-listings', 'listings'))

export const listingCache = {
  get: (storeId: string): Promise<string | undefined> => get<string>(PREFIX + storeId, listings()),
  set: (storeId: string, value: string): Promise<void> => set(PREFIX + storeId, value, listings()),
}

/** Drop a store's saved listing (the store was removed). Never throws. */
export function forgetStoreListing(storeId: string): void {
  try {
    void del(PREFIX + storeId, listings()).catch(() => {})
  } catch {
    // No IndexedDB here (tests, some private modes): nothing was saved.
  }
}
