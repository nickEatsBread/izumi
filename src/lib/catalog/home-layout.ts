import { persisted } from 'svelte-persisted-store'
import { get } from 'svelte/store'
import { hiddenHomeRows, homeRowOrder } from '$lib/settings/ui'
import type { CatalogSelection } from '$lib/settings/catalog'
import type { CatalogHomeRowOption } from './types'

export type CatalogHomeLayoutKey = 'anilist' | 'kitsu' | 'tmdb' | 'stremio' | 'jvm'

export interface CatalogHomeLayout {
  /** Contains visible and hidden rows so a hidden row remembers its former position. */
  order: string[]
  disabled: string[]
}

export type CatalogHomeLayouts = Partial<Record<CatalogHomeLayoutKey, CatalogHomeLayout>>

/** Seed AniList from the pre-existing Interface setting. This is a one-time compatibility
 * migration: persisted-store uses this value only when the new key does not already exist. */
export const catalogHomeLayouts = persisted<CatalogHomeLayouts>('catalog-home-layouts-v1', {
  anilist: { order: get(homeRowOrder), disabled: get(hiddenHomeRows) },
})

export const catalogHomeLayoutKey = (selection: CatalogSelection): CatalogHomeLayoutKey =>
  selection === 'auto' || selection === 'anilist' ? 'anilist' : selection

/** Repair stale/partial persisted layouts, append newly shipped rows, and apply their defaults.
 * Unknown saved ids are deliberately dropped so removing a preset cannot leave ghost rows. */
export function resolveCatalogHomeRows(
  selection: CatalogSelection,
  options: CatalogHomeRowOption[],
  layouts: CatalogHomeLayouts,
): Array<CatalogHomeRowOption & { enabled: boolean }> {
  const layout = layouts[catalogHomeLayoutKey(selection)]
  const optionById = new Map(options.map((option) => [option.id, option]))
  const rawOrder = Array.isArray(layout?.order) ? layout.order.filter((id): id is string => typeof id === 'string') : []
  const rawDisabled = Array.isArray(layout?.disabled) ? layout.disabled.filter((id): id is string => typeof id === 'string') : []
  const savedOrder = rawOrder.filter((id, index, ids) => optionById.has(id) && ids.indexOf(id) === index)
  const order = [...savedOrder, ...options.map((option) => option.id).filter((id) => !savedOrder.includes(id))]
  const disabled = new Set(layout ? rawDisabled : options.filter((option) => option.defaultEnabled === false).map((option) => option.id))

  // A preset introduced after a user saved this provider follows its shipped default. Existing
  // rows are completely user-controlled, including opt-in rows the user enabled.
  if (layout) {
    const knownWhenSaved = new Set(rawOrder)
    for (const option of options) if (!knownWhenSaved.has(option.id) && option.defaultEnabled === false) disabled.add(option.id)
  }

  return order.flatMap((id) => {
    const option = optionById.get(id)
    return option ? [{ ...option, enabled: !disabled.has(id) }] : []
  })
}

export function catalogHomeLayoutFromRows(rows: Array<CatalogHomeRowOption & { enabled: boolean }>): CatalogHomeLayout {
  return {
    order: rows.map((row) => row.id),
    disabled: rows.filter((row) => !row.enabled).map((row) => row.id),
  }
}

export function resetCatalogHomeLayout(selection: CatalogSelection): void {
  const key = catalogHomeLayoutKey(selection)
  catalogHomeLayouts.update((layouts) => {
    const next = { ...layouts }
    delete next[key]
    return next
  })
}
