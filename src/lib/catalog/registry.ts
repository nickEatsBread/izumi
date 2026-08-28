import type { CatalogSelection } from '$lib/settings/catalog'
import { ANILIST_HOME_ROWS, CONTINUE_HOME_ROW } from './home-options'
import type { CatalogHomeRowOption, CatalogProvider } from './types'

export const providerChain = (selection: CatalogSelection): CatalogSelection[] => {
  if (selection === 'auto') return ['anilist', 'kitsu']
  return [selection]
}

export async function loadCatalogProvider(selection: Exclude<CatalogSelection, 'auto' | 'anilist'>): Promise<CatalogProvider> {
  if (selection === 'kitsu') return (await import('./providers/kitsu')).kitsuCatalog
  if (selection === 'tmdb') return (await import('./providers/tmdb')).tmdbCatalog
  if (selection === 'jvm') return (await import('./providers/jvm')).jvmCatalog
  return (await import('./providers/stremio')).stremioCatalog
}

export async function catalogHomeRowOptions(selection: CatalogSelection, signal?: AbortSignal): Promise<CatalogHomeRowOption[]> {
  if (selection === 'auto' || selection === 'anilist') return ANILIST_HOME_ROWS
  const provider = await loadCatalogProvider(selection)
  return provider.homeRows?.(signal) ?? [CONTINUE_HOME_ROW]
}
