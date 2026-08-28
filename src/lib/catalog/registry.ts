import { catalogLabel, mergedCatalogProviders, type CatalogSelection } from '$lib/settings/catalog'
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

export const mergedCatalogHomeRowId = (selection: CatalogSelection, rowId: string): string =>
  `${selection}:${rowId}`

export function decodeMergedCatalogHomeRowId(id: string): { selection: CatalogSelection; rowId: string } | null {
  const split = id.indexOf(':')
  if (split < 1) return null
  const selection = id.slice(0, split) as CatalogSelection
  if (!mergedCatalogProviders([selection]).includes(selection)) return null
  return { selection, rowId: id.slice(split + 1) }
}

/** Build Merged Home's independent row library. Only the first three normally-enabled rows from
 * each provider start on Home, preventing a fresh merged setup from firing dozens of requests. */
export async function mergedCatalogHomeRowOptions(
  providers: unknown,
  signal?: AbortSignal,
): Promise<CatalogHomeRowOption[]> {
  const selections = mergedCatalogProviders(providers)
  const batches = await Promise.allSettled(selections.map(async (selection) => ({
    selection,
    rows: await catalogHomeRowOptions(selection, signal),
  })))
  const rows: CatalogHomeRowOption[] = [CONTINUE_HOME_ROW]
  for (const batch of batches) {
    if (batch.status !== 'fulfilled') continue
    let enabledDefaults = 0
    for (const row of batch.value.rows) {
      if (row.id === CONTINUE_HOME_ROW.id) continue
      const normallyEnabled = row.defaultEnabled !== false
      const defaultEnabled = normallyEnabled && enabledDefaults < 3
      if (normallyEnabled) enabledDefaults++
      rows.push({
        ...row,
        id: mergedCatalogHomeRowId(batch.value.selection, row.id),
        group: catalogLabel(batch.value.selection),
        defaultEnabled,
      })
    }
  }
  return rows
}
