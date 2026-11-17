import { get } from 'svelte/store'
import type { ThemeRelease } from '$lib/themes/packages'
import { allStores, type StoreFeed } from './feeds'
import { loadStoreAndPin } from './service'
import { loadListings } from './listings'

/** A theme as listed by one store. The store URL is the theme's install origin, so a theme can only
 *  ever update from the store it came from. */
export interface ThemeListing {
  release: ThemeRelease
  origin: string
  storeName: string
}

export function loadThemeListings(options: { force?: boolean } = {}) {
  return loadListings<ThemeListing>((entry, store) => entry.install.type === 'theme'
    ? { release: entry.install.release, origin: store.url, storeName: store.name }
    : undefined, 'themes', options)
}

export function themeStoreFor(origin: string): StoreFeed | undefined {
  return get(allStores).find((store) => store.url === origin)
}

export async function findStoreThemeRelease(origin: string, id: string): Promise<ThemeRelease | undefined> {
  const store = themeStoreFor(origin)
  if (!store) return undefined
  const result = await loadStoreAndPin(store, { force: true })
  if (result.trust.state === 'locked') throw new Error(`${store.name} failed its signing-key check. Review it under Manage stores before updating its themes.`)
  if (!result.listing) return undefined
  for (const entry of result.listing.entries) {
    if (entry.install.type === 'theme' && entry.install.release.id === id) return entry.install.release
  }
  return undefined
}
