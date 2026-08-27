export type SourceStatusFilter = 'all' | 'enabled' | 'disabled'
export type SourceTypeFilter = 'all' | 'addon' | 'community' | 'catalog' | 'package'
export type ManagedSourceType = Exclude<SourceTypeFilter, 'all'>

export type ManagedSourceFacts = {
  types: readonly ManagedSourceType[]
  enabled: boolean
  disabled: boolean
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
