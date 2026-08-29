import { writable } from 'svelte/store'
import { catalogHomeLayoutKey, catalogHomeLayouts, type CatalogHomeTarget } from './home-layout'
import type { CatalogHomeRowOption } from './types'

export const homeEditorOpen = writable(false)
export const homeEditorInsertRequest = writable<{ target: CatalogHomeTarget; beforeId: string | null } | null>(null)

function updateLayout(
  target: CatalogHomeTarget,
  transform: (order: string[], disabled: string[]) => { order: string[]; disabled: string[] },
): void {
  const key = catalogHomeLayoutKey(target)
  catalogHomeLayouts.update((layouts) => {
    const current = layouts[key]
    const next = transform([...(current?.order ?? [])], [...(current?.disabled ?? [])])
    return { ...layouts, [key]: next }
  })
}

/** Reorder the rows currently on screen while preserving any hidden/new rows after them. */
export function moveHomeRowBefore(
  target: CatalogHomeTarget,
  visibleIds: string[],
  rowId: string,
  beforeId: string | null,
): void {
  if (!visibleIds.includes(rowId) || rowId === beforeId) return
  const visible = visibleIds.filter((id) => id !== rowId)
  const index = beforeId ? visible.indexOf(beforeId) : visible.length
  visible.splice(index < 0 ? visible.length : index, 0, rowId)
  if (visible.every((id, position) => id === visibleIds[position])) return
  updateLayout(target, (order, disabled) => ({
    order: [...visible, ...order.filter((id) => !visibleIds.includes(id))],
    disabled,
  }))
}

export function moveHomeRowBy(
  target: CatalogHomeTarget,
  visibleIds: string[],
  rowId: string,
  direction: -1 | 1,
): void {
  const index = visibleIds.indexOf(rowId)
  const destination = index + direction
  if (index < 0 || destination < 0 || destination >= visibleIds.length) return
  const reordered = [...visibleIds]
  ;[reordered[index], reordered[destination]] = [reordered[destination], reordered[index]]
  updateLayout(target, (order, disabled) => ({
    order: [...reordered, ...order.filter((id) => !visibleIds.includes(id))],
    disabled,
  }))
}

export function hideHomeRow(target: CatalogHomeTarget, visibleIds: string[], rowId: string): void {
  updateLayout(target, (order, disabled) => ({
    order: [...visibleIds, ...order.filter((id) => !visibleIds.includes(id))],
    disabled: [...new Set([...disabled, rowId])],
  }))
}

export function insertHomeRow(
  target: CatalogHomeTarget,
  rows: Array<CatalogHomeRowOption & { enabled: boolean }>,
  rowId: string,
  beforeId: string | null,
): void {
  const added = rows.find((row) => row.id === rowId)
  if (!added) return
  const visible = rows.filter((row) => row.enabled && row.id !== rowId)
  const index = beforeId ? visible.findIndex((row) => row.id === beforeId) : visible.length
  visible.splice(index < 0 ? visible.length : index, 0, { ...added, enabled: true })
  const hidden = rows.filter((row) => !row.enabled && row.id !== rowId)
  const key = catalogHomeLayoutKey(target)
  catalogHomeLayouts.update((layouts) => ({
    ...layouts,
    [key]: {
      order: [...visible, ...hidden].map((row) => row.id),
      disabled: hidden.map((row) => row.id),
    },
  }))
}
