import type { ThemeListing } from '$lib/store/themes'
import type { InstalledTheme } from './installed'

export interface ThemeShelf { id: string; title: string; listings: ThemeListing[] }

/** Storefront shelves: the official catalog grouped by tag (first match wins), then one shelf per
 *  other store. Empty shelves are left out. */
export function shelvesFor(listings: readonly ThemeListing[], official: string): ThemeShelf[] {
  const sites: ThemeShelf = { id: 'sites', title: 'Familiar layouts', listings: [] }
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

/** izumi's own appearance: the first row of the Installed section. */
export const DEFAULT_THEME_KEY = 'izumi-default'
/** A theme's identity on the page and in its URL: an install and its listing share it. */
export const themeKey = (origin: string, id: string) => `${origin}|${id}`

/** A gallery card: the default, an install (with its listing while a store lists it), or a listing
 *  that is not installed. */
export interface ThemeEntry { key: string; listing?: ThemeListing; installed?: InstalledTheme }
export interface ThemeSection { id: string; title: string; entries: ThemeEntry[] }

const matches = (query: string, ...fields: (string | readonly string[])[]) =>
  !query || fields.flat().join(' ').toLowerCase().includes(query)

/** The gallery: Installed (the default first) and then the store shelves, filtered by `query`. An
 *  installed theme shows only under Installed, never again in its store's shelf. Empty sections are
 *  left out. */
export function themeSections(installed: readonly InstalledTheme[], listings: readonly ThemeListing[], official: string, rawQuery = ''): ThemeSection[] {
  const query = rawQuery.trim().toLowerCase()
  const listingOf = (item: InstalledTheme) => listings.find((listing) => listing.release.id === item.id && listing.origin === item.origin)
  const isInstalled = (listing: ThemeListing) => installed.some((item) => item.id === listing.release.id && item.origin === listing.origin)
  const mine: ThemeEntry[] = [
    ...matches(query, 'Izumi default') ? [{ key: DEFAULT_THEME_KEY }] : [],
    ...installed.filter((item) => matches(query, item.package.name, item.package.author, item.package.description))
      .map((item) => ({ key: themeKey(item.origin, item.id), installed: item, listing: listingOf(item) })),
  ]
  const shown = listings.filter((listing) => !isInstalled(listing) && matches(query, listing.release.name, listing.release.author, listing.release.description, listing.release.tags))
  return [
    { id: 'installed', title: 'Installed', entries: mine },
    ...shelvesFor(shown, official).map((shelf) => ({ id: shelf.id, title: shelf.title,
      entries: shelf.listings.map((listing) => ({ key: themeKey(listing.origin, listing.release.id), listing })) })),
  ].filter((section) => section.entries.length)
}
