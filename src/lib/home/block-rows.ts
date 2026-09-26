// Blocks as Home rows. A block id only survives `resolveCatalogHomeRows` when it is offered as an
// option, and only the blocks a layout already contains are offered — so a block added to one
// catalog's Home never appears on another's.
import { get, writable } from 'svelte/store'
import { catalogHomeLayoutKey, catalogHomeLayouts, type CatalogHomeLayouts, type CatalogHomeTarget } from '$lib/catalog/home-layout'
import { insertHomeRow } from '$lib/catalog/home-editor'
import type { CatalogHomeRowOption } from '$lib/catalog/types'
import { BLOCK_META, defaultBlock, homeBlocks, isBlockId, nextBlockId, parseHomeBlock, type HomeBlock, type HomeBlockType } from './blocks'

/** The block whose settings sheet is open (Edit Home). */
export const homeBlockSettingsId = writable<string | null>(null)

export const blockTitle = (block: HomeBlock): string => block.title || BLOCK_META[block.type].title

export function blockRowOptions(target: CatalogHomeTarget, layouts: CatalogHomeLayouts, blocks: Record<string, HomeBlock>): CatalogHomeRowOption[] {
  const order = layouts[catalogHomeLayoutKey(target)]?.order
  if (!Array.isArray(order)) return []
  return order.flatMap((id) => {
    const block = typeof id === 'string' && isBlockId(id) ? blocks[id] : undefined
    return block ? [{ id, title: blockTitle(block), group: 'Blocks', defaultEnabled: true }] : []
  })
}

/** Create a block with default settings and place it before `beforeId` (null = the end). */
export function addHomeBlock(
  target: CatalogHomeTarget,
  rows: Array<CatalogHomeRowOption & { enabled: boolean }>,
  type: HomeBlockType,
  beforeId: string | null,
  roles: string[],
): string {
  const blocks = get(homeBlocks)
  const id = nextBlockId(type, Object.keys(blocks))
  homeBlocks.set({ ...blocks, [id]: defaultBlock(type, roles) })
  insertHomeRow(target, [...rows, { id, title: BLOCK_META[type].title, enabled: false }], id, beforeId)
  return id
}

export function removeHomeBlock(target: CatalogHomeTarget, id: string): void {
  const key = catalogHomeLayoutKey(target)
  catalogHomeLayouts.update((layouts) => {
    const current = layouts[key]
    if (!current) return layouts
    return { ...layouts, [key]: { order: current.order.filter((row) => row !== id), disabled: current.disabled.filter((row) => row !== id) } }
  })
  homeBlocks.update((blocks) => {
    const next = { ...blocks }
    delete next[id]
    return next
  })
}

/** Merge a settings change and store the repaired result. The block's type never changes. */
export function updateHomeBlock(id: string, patch: Partial<HomeBlock>): void {
  homeBlocks.update((blocks) => {
    const current = blocks[id]
    if (!current) return blocks
    const next = parseHomeBlock({ ...current, ...patch, type: current.type })
    return next ? { ...blocks, [id]: next } : blocks
  })
}

/** Forget settings for blocks that no saved layout references (after a layout reset). */
export function pruneHomeBlocks(): void {
  const referenced = new Set(Object.values(get(catalogHomeLayouts)).flatMap((layout) => layout?.order ?? []))
  homeBlocks.update((blocks) => Object.fromEntries(Object.entries(blocks).filter(([id]) => referenced.has(id))))
}

/** Main and side columns. Phones drop side-column blocks unless the block opts in with `phone`. */
export function splitHomeColumns(ids: string[], blocks: Record<string, HomeBlock>, phone: boolean): { main: string[]; aside: string[] } {
  const main: string[] = []
  const aside: string[] = []
  for (const id of ids) {
    const block = blocks[id]
    if (block?.area !== 'aside') main.push(id)
    else if (!phone || block.phone) aside.push(id)
  }
  return { main, aside }
}
