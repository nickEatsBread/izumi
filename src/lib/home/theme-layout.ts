// A theme's Home, resolved against the current catalog's rows: roles become that catalog's row ids
// (a role it lacks is skipped), blocks become ephemeral `theme:<index>` blocks. Forking copies the
// result into the user's own layout — theme blocks become the user's blocks — and turns the theme
// layout off for that design, so the user's layout is never overwritten without being asked.
import { get } from 'svelte/store'
import { catalogHomeLayoutKey, catalogHomeLayouts, type CatalogHomeTarget } from '$lib/catalog/home-layout'
import type { ThemeLayoutEntry } from '$lib/themes/presentation'
import { setThemeLayoutEnabled } from '$lib/themes/layout-state'
import { homeAsideWidth, homeBlocks, nextBlockId, type HomeBlock } from './blocks'
import { resolveRoles } from './row-source'

/** `roles`: the theme role each placed row fills, so the row is styled as that role on every catalog. */
export interface ThemeHome { rows: string[]; blocks: Record<string, HomeBlock>; roles: Record<string, string> }

export const isThemeBlockId = (id: string): boolean => /^theme:\d+$/.test(id)

/** Before a catalog answers, what a theme's Home is known to show: whether it opens on the banner
 *  (`first`) or has a row at all. Without a theme layout, both are left to the catalog. */
export function themeHomeHas(entries: ThemeLayoutEntry[] | undefined, role: string, first = false): boolean | null {
  if (!entries) return null
  return (first ? entries.slice(0, 1) : entries).some((entry) => 'role' in entry && entry.role === role)
}

/** `rest`: the catalog's other rows, which follow the theme's own on a catalog it was not drawn for. */
export function resolveThemeHome(entries: ThemeLayoutEntry[], target: CatalogHomeTarget, optionIds: string[], rest: string[] = []): ThemeHome {
  const rows: string[] = []
  const blocks: Record<string, HomeBlock> = {}
  const roles: Record<string, string> = {}
  const tabsOf = (entry: ThemeLayoutEntry) => ('tabs' in entry && Array.isArray(entry.tabs) ? entry.tabs as { label: string; role: string }[] : [])
  const ids = resolveRoles(target, entries.flatMap((entry) => ('block' in entry ? tabsOf(entry).map((tab) => tab.role) : [entry.role])), optionIds, rest.length ? rest : undefined)
  entries.forEach((entry, index) => {
    if ('block' in entry) {
      const { block: type, ...settings } = entry
      const id = `theme:${index}`
      // Tabs name the resolved rows, so the block (and a fork of it) reads this catalog's rows directly.
      // A tab this catalog has no row for is left out, and so is a tabbed block left with none.
      const tabs = tabsOf(entry).flatMap((tab) => (ids.has(tab.role) ? [{ ...tab, role: ids.get(tab.role)! }] : []))
      if (tabsOf(entry).length && !tabs.length) return
      const opening = 'default' in settings && typeof settings.default === 'number' ? tabsOf(entry)[settings.default] : undefined
      const kept = opening ? tabs.findIndex((tab) => tab.label === opening.label) : -1
      const { default: _default, ...rest5 } = settings as typeof settings & { default?: number }
      blocks[id] = { type, ...rest5, ...('tabs' in entry ? { tabs } : {}), ...(kept > 0 ? { default: kept } : {}) } as HomeBlock
      rows.push(id)
      return
    }
    const id = entry.role === 'hero' ? 'hero' : ids.get(entry.role)
    if (!id || !optionIds.includes(id) || rows.includes(id)) return
    rows.push(id)
    roles[id] = entry.role
  })
  const taken = new Set([...rows, ...ids.values()])
  return { rows: [...rows, ...rest.filter((id) => !taken.has(id))], blocks, roles }
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
