import type { PluginListing } from '$lib/store/plugins'
import type { StoreFeed } from '$lib/store/feeds'
import { sourceLabel } from '$lib/extensions/catalog'
import { newerVersion } from '$lib/themes/packages'
import { PLUGIN_API } from './manifest'
import type { InstalledPlugin } from './registry'

/** A plugin's identity on the page and in its URL: an install and its listing share it. */
export const pluginKey = (origin: string, id: string) => `${origin}|${id}`

/** A gallery card: an install (with its listing while its store lists it), or a listing that is not
 *  installed. */
export interface PluginEntry { key: string; listing?: PluginListing; installed?: InstalledPlugin }
export interface PluginSection { id: string; title: string; entries: PluginEntry[] }

/** The gallery, like the Themes page: Installed, then one section per store in the stores' order,
 *  filtered by `query`. An installed plugin shows only under Installed, never again in its store's
 *  section. Empty sections are left out. */
export function pluginSections(installed: readonly InstalledPlugin[], listings: readonly PluginListing[], rawQuery = ''): PluginSection[] {
  const query = rawQuery.trim().toLowerCase()
  const matches = (...fields: (string | undefined)[]) => !query || fields.join(' ').toLowerCase().includes(query)
  const listingOf = (item: InstalledPlugin) => listings.find((listing) => listing.entry.id === item.manifest.id && listing.origin === item.origin)
  const isInstalled = (listing: PluginListing) => installed.some((item) => item.manifest.id === listing.entry.id && item.origin === listing.origin)
  const mine: PluginSection = {
    id: 'installed',
    title: 'Installed',
    entries: installed.filter((item) => matches(item.manifest.name, item.manifest.author, item.manifest.description))
      .map((item) => ({ key: pluginKey(item.origin, item.manifest.id), installed: item, listing: listingOf(item) })),
  }
  const stores = new Map<string, PluginSection>()
  for (const listing of listings) {
    if (isInstalled(listing) || !matches(listing.entry.name, listing.entry.author, listing.entry.description)) continue
    let section = stores.get(listing.origin)
    if (!section) stores.set(listing.origin, section = { id: `store-${listing.entry.storeId}`, title: listing.storeName, entries: [] })
    section.entries.push({ key: pluginKey(listing.origin, listing.entry.id), listing })
  }
  return [mine, ...stores.values()].filter((section) => section.entries.length)
}

/** Where an install came from, in words: its store's name, or the file or link it was added from. */
export function pluginOriginLabel(origin: string, stores: readonly StoreFeed[]): string {
  if (origin === 'file') return 'A file on this device'
  return stores.find((store) => store.url === origin)?.name ?? sourceLabel(origin)
}

/** The store lists a newer version than the one installed from it. */
export const pluginUpdatable = (entry: PluginEntry) =>
  !!entry.installed && !!entry.listing && !!entry.listing.entry.version && newerVersion(entry.listing.entry.version, entry.installed.manifest.version)

/** Why this client can't install a listing, else ''. */
export const pluginNote = (entry: PluginEntry) =>
  entry.listing && !entry.installed && entry.listing.install.pluginApi > PLUGIN_API ? 'Needs a newer izumi' : ''
