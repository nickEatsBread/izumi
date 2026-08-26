import { persisted } from 'svelte-persisted-store'
import { derived, get, writable } from 'svelte/store'

export type CatalogSelection = 'auto' | 'anilist' | 'kitsu' | 'tmdb' | 'stremio'

export const CATALOG_SELECTIONS: CatalogSelection[] = ['auto', 'anilist', 'kitsu', 'tmdb', 'stremio']

export const catalogLabel = (provider: CatalogSelection): string => ({
  auto: 'Automatic anime',
  anilist: 'AniList',
  kitsu: 'Kitsu',
  tmdb: 'TMDB',
  stremio: 'Stremio',
})[provider]

export function normalizeCatalogProviders(value: unknown, fallback: CatalogSelection = 'auto'): CatalogSelection[] {
  if (!Array.isArray(value)) return [fallback]
  const valid = value.filter((item): item is CatalogSelection =>
    typeof item === 'string' && CATALOG_SELECTIONS.includes(item as CatalogSelection))
  return [...new Set(valid)].length ? [...new Set(valid)] : [fallback]
}

function adjacentCatalogProvider(
  current: CatalogSelection,
  providers: unknown,
  direction: 1 | -1,
): CatalogSelection {
  const enabled = normalizeCatalogProviders(providers, current)
  const index = enabled.indexOf(current)
  if (index < 0) return enabled[0]
  return enabled[(index + direction + enabled.length) % enabled.length]
}

export const nextCatalogProvider = (current: CatalogSelection, providers: unknown): CatalogSelection =>
  adjacentCatalogProvider(current, providers, 1)

export const previousCatalogProvider = (current: CatalogSelection, providers: unknown): CatalogSelection =>
  adjacentCatalogProvider(current, providers, -1)

/** `auto` preserves Izumi's anime-first experience and uses the existing AniList → Kitsu → Jikan
 * circuit breaker. Kitsu/TMDB/Stremio selections use their native adapters and identities. */
const legacyCatalogProvider = persisted<CatalogSelection>('catalog-provider', 'auto')

/** The platform selected when a new app session starts. Existing installs inherit their previous
 * single-platform choice once; changing the active platform through the logo does not rewrite it. */
export const catalogDefaultProvider = persisted<CatalogSelection>(
  'catalog-default-provider',
  get(legacyCatalogProvider),
)

/** Current platform for this app session. It deliberately is not persisted: startup always honours
 * `catalogDefaultProvider`, while logo clicks can move through the enabled platforms temporarily. */
export const catalogProvider = writable<CatalogSelection>(get(catalogDefaultProvider))

/** Platforms available to the user. The original single-provider store remains the active tab so
 * existing installs and all provider-specific filters keep their behaviour. */
export const catalogProviders = persisted<CatalogSelection[]>('catalog-providers', [get(catalogDefaultProvider)])
export const enabledCatalogProviders = derived(catalogProviders, ($providers) => normalizeCatalogProviders($providers))

/** A desktop app cannot safely embed a shared TMDB application credential in its distributable.
 * Users may supply their own read token; packaged/private builds can instead set PUBLIC_TMDB_READ_TOKEN. */
export const tmdbReadToken = persisted<string>('tmdb-read-token', '')

export const isLegacyAniListCatalog = (provider: CatalogSelection): boolean =>
  provider === 'auto' || provider === 'anilist'
