// A theme's Home, resolved against the current catalog's rows: roles become that catalog's row ids
// (a role it lacks is skipped), blocks become ephemeral `theme:<index>` blocks. Forking copies the
// result into the user's own layout — theme blocks become the user's blocks — and turns the theme
// layout off for that design, so the user's layout is never overwritten without being asked.
import { get } from 'svelte/store'
import { catalogHomeLayoutKey, catalogHomeLayouts, type CatalogHomeTarget } from '$lib/catalog/home-layout'
import type { ThemeLayoutEntry } from '$lib/themes/presentation'
import { setThemeLayoutEnabled } from '$lib/themes/layout-state'
import { homeAsideWidth, homeBlocks, nextBlockId, type HomeBlock } from './blocks'
import { resolveRowId } from './row-source'

export interface ThemeHome { rows: string[]; blocks: Record<string, HomeBlock> }

export const isThemeBlockId = (id: string): boolean => /^theme:\d+$/.test(id)

export function resolveThemeHome(entries: ThemeLayoutEntry[], target: CatalogHomeTarget, optionIds: string[]): ThemeHome {
  const rows: string[] = []
  const blocks: Record<string, HomeBlock> = {}
  entries.forEach((entry, index) => {
    if ('block' in entry) {
      const { block: type, ...settings } = entry
      const id = `theme:${index}`
      blocks[id] = { type, ...settings } as HomeBlock
      rows.push(id)
      return
    }
    const id = entry.role === 'hero' ? 'hero' : resolveRowId(target, entry.role, optionIds)
    if (id && optionIds.includes(id) && !rows.includes(id)) rows.push(id)
  })
  return { rows, blocks }
}

export function forkThemeHome(target: CatalogHomeTarget, home: ThemeHome, optionIds: string[], themeKey: string, asideWidth?: number): void {
  const current = get(homeBlocks)
  const layouts = get(catalogHomeLayouts)
  const taken = [...Object.keys(current), ...Object.values(layouts).flatMap((layout) => [...(layout?.order ?? []), ...(layout?.disabled ?? [])])]
  const blocks = { ...current }
  const order = home.rows.map((id) => {
    const block = home.blocks[id]
    if (!block) return id
    const copy = nextBlockId(block.type, [...taken, ...Object.keys(blocks)])
    blocks[copy] = block
    return copy
  })
  const hidden = optionIds.filter((id) => !order.includes(id))
  homeBlocks.set(blocks)
  catalogHomeLayouts.update((all) => ({ ...all, [catalogHomeLayoutKey(target)]: { order: [...order, ...hidden], disabled: hidden } }))
  if (asideWidth) homeAsideWidth.set(asideWidth)
  setThemeLayoutEnabled(themeKey, false)
}
