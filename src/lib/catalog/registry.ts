import type { CatalogSelection } from '$lib/settings/catalog'
import type { CatalogProvider } from './types'

export const providerChain = (selection: CatalogSelection): CatalogSelection[] => {
  if (selection === 'auto') return ['anilist', 'kitsu']
  return [selection]
}

export async function loadCatalogProvider(selection: Exclude<CatalogSelection, 'auto' | 'anilist'>): Promise<CatalogProvider> {
  if (selection === 'kitsu') return (await import('./providers/kitsu')).kitsuCatalog
  if (selection === 'tmdb') return (await import('./providers/tmdb')).tmdbCatalog
  return (await import('./providers/stremio')).stremioCatalog
}
