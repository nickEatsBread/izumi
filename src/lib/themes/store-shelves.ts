import type { ThemeListing } from '$lib/store/themes'

export interface ThemeShelf { id: string; title: string; listings: ThemeListing[] }

/** Storefront shelves: the official catalog grouped by tag (first match wins), then one shelf per
 *  other store. Empty shelves are left out. */
export function shelvesFor(listings: readonly ThemeListing[], official: string): ThemeShelf[] {
  const sites: ThemeShelf = { id: 'sites', title: 'Look like the sites you know', listings: [] }
  const phones: ThemeShelf = { id: 'phones', title: 'Made for phones', listings: [] }
  const classic: ThemeShelf = { id: 'classic', title: 'Classic themes', listings: [] }
  const stores = new Map<string, ThemeShelf>()
  for (const listing of listings) {
    if (listing.origin !== official) {
      let shelf = stores.get(listing.origin)
      if (!shelf) stores.set(listing.origin, shelf = { id: `store-${stores.size}`, title: listing.storeName, listings: [] })
      shelf.listings.push(listing)
      continue
    }
    const tags = listing.release.tags.map((tag) => tag.toLowerCase())
    const shelf = tags.includes('site') ? sites : tags.includes('phone') || tags.includes('app') ? phones : classic
    shelf.listings.push(listing)
  }
  return [sites, phones, classic, ...stores.values()].filter((shelf) => shelf.listings.length)
}
