export type SourceStatusFilter = 'all' | 'enabled' | 'disabled'
export type SourceTypeFilter = 'all' | 'addon' | 'community' | 'catalog' | 'package'
export type SourceSortMode = 'enabled' | 'disabled' | 'name-asc' | 'name-desc' | 'added'
export type ManagedSourceType = Exclude<SourceTypeFilter, 'all'>

export type ManagedSourceFacts = {
  types: readonly ManagedSourceType[]
  enabled: boolean
  disabled: boolean
}

export type ManagedSourceSortEntry = Pick<ManagedSourceFacts, 'enabled' | 'disabled'> & {
  id: string
  label: string
}

/** A container such as a package catalog may match both statuses when it contains a mixture. */
export function matchesSourceFilters(
  source: ManagedSourceFacts,
  status: SourceStatusFilter,
  type: SourceTypeFilter,
): boolean {
  if (type !== 'all' && !source.types.includes(type)) return false
  if (status === 'enabled') return source.enabled
  if (status === 'disabled') return source.disabled
  return true
}

export function matchesSourceQuery(query: string, ...values: Array<string | null | undefined>): boolean {
  const needle = query.trim().toLocaleLowerCase()
  return !needle || values.some((value) => value?.toLocaleLowerCase().includes(needle))
}

/** Sort a merged source list. Stable ties preserve the order in which sources were added. */
export function sortManagedSources<T extends ManagedSourceSortEntry>(
  sources: readonly T[],
  mode: SourceSortMode,
): T[] {
  if (mode === 'added') return [...sources]
  const nameOrder = (a: T, b: T) => a.label.localeCompare(b.label, undefined, {
    numeric: true,
    sensitivity: 'base',
  })
  if (mode === 'name-asc') return [...sources].sort(nameOrder)
  if (mode === 'name-desc') return [...sources].sort((a, b) => nameOrder(b, a))

  const statusRank = (source: T) => {
    if (mode === 'enabled') return source.enabled ? 0 : source.disabled ? 2 : 1
    return source.disabled ? 0 : source.enabled ? 2 : 1
  }
  return [...sources].sort((a, b) => statusRank(a) - statusRank(b) || nameOrder(a, b))
}
