// Which Settings subcategories fold and how they start (spec §5.3). In controller mode every
// subcategory folds: the first starts open, the rest closed, and whatever the user opens or closes
// is remembered per section for the session (memory only). Elsewhere only Advanced folds, unless a
// page says otherwise.

const remembered = new Map<string, Map<string, boolean>>()

export function subcategoryFoldable(controller: boolean, collapsible: boolean | undefined, advanced: boolean): boolean {
  return controller || (collapsible ?? advanced)
}

/** Whether a subcategory starts collapsed. `first`: it is its section's first subcategory. */
export function subcategoryStartsCollapsed(input: {
  foldable: boolean
  controller: boolean
  section: string | undefined
  id: string
  first: boolean
}): boolean {
  if (!input.foldable) return false
  if (!input.controller || !input.section) return true
  return !(remembered.get(input.section)?.get(input.id) ?? input.first)
}

/** Remember an open or a close in controller mode; elsewhere nothing is kept. */
export function rememberSubcategory(controller: boolean, section: string | undefined, id: string, open: boolean): void {
  if (!controller || !section) return
  let bySection = remembered.get(section)
  if (!bySection) remembered.set(section, (bySection = new Map()))
  bySection.set(id, open)
}

/** The header's second line: the page's own summary, else in controller mode how many rows it holds. */
export function subcategoryLine(summary: string | undefined, controller: boolean, rows: number): string {
  if (summary) return summary
  if (!controller || rows < 1) return ''
  return rows === 1 ? '1 setting' : `${rows} settings`
}

export function resetSubcategoryFoldForTests(): void {
  remembered.clear()
}
