import { get } from 'svelte/store'
import type { ThemeRelease } from '$lib/themes/packages'
import { allStores, enabledStores, type StoreFeed } from './feeds'
import { loadStoreAndPin } from './service'

/** A theme as listed by one store. The store URL is the theme's install origin, so a theme can only
 *  ever update from the store it came from. */
export interface ThemeListing {
  release: ThemeRelease
  origin: string
  storeName: string
}

export async function loadThemeListings(
  options: { force?: boolean } = {},
): Promise<{ listings: ThemeListing[]; cached: boolean; errors: string[] }> {
  const results = await Promise.all(get(enabledStores).map((store) => loadStoreAndPin(store, options)))
  const listings: ThemeListing[] = []
  const errors: string[] = []
  let cached = false
  for (const result of results) {
    if (result.error) {
      errors.push(`${result.store.name}: ${result.error}`)
      if (result.listing) cached = true
    }
    if (!result.listing || result.trust.state === 'locked') continue
    for (const entry of result.listing.entries) {
      if (entry.install.type === 'theme') {
        listings.push({ release: entry.install.release, origin: result.store.url, storeName: result.store.name })
      }
    }
  }
  return { listings, cached, errors }
}

export function themeStoreFor(origin: string): StoreFeed | undefined {
  return get(allStores).find((store) => store.url === origin)
}

export async function findStoreThemeRelease(origin: string, id: string): Promise<ThemeRelease | undefined> {
  const store = themeStoreFor(origin)
  if (!store) return undefined
  const result = await loadStoreAndPin(store, { force: true })
  if (!result.listing || result.trust.state === 'locked') return undefined
  for (const entry of result.listing.entries) {
    if (entry.install.type === 'theme' && entry.install.release.id === id) return entry.install.release
  }
  return undefined
}
