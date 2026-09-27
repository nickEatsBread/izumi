import type { JvmSourceFilter } from './manager'

const sameState = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

function withoutState({ state: _state, ...filter }: JvmSourceFilter): JvmSourceFilter {
  return filter
}

function strip(filter: JvmSourceFilter, initial: JvmSourceFilter | undefined): { filter: JvmSourceFilter; changed: boolean } {
  if (filter.type === 'Group' && Array.isArray(filter.state)) {
    const initialChildren = Array.isArray(initial?.state) ? initial.state as JvmSourceFilter[] : []
    const children = (filter.state as JvmSourceFilter[]).map((child, index) => strip(child, initialChildren[index]))
    return children.some((child) => child.changed)
      ? { filter: { ...filter, state: children.map((child) => child.filter) }, changed: true }
      : { filter: withoutState(filter), changed: false }
  }
  if (initial && sameState(filter.state, initial.state)) return { filter: withoutState(filter), changed: false }
  return { filter, changed: true }
}

/**
 * The filter list an Aniyomi search should receive.
 *
 * Aniyomi browses a source's Popular or Latest list until the user applies a filter, so this is
 * `undefined` when every filter still holds the source's own default. Otherwise every position is
 * kept, because the runtime applies states by index, and each untouched state is omitted: the
 * runtime then leaves that filter exactly as the extension built it. Sending the default back is
 * not equivalent — a Sort with no selection serializes as `{}`, and the runtime turns that into
 * "first option, ascending".
 */
export function changedJvmFilters(
  filters: JvmSourceFilter[],
  defaults: JvmSourceFilter[],
): JvmSourceFilter[] | undefined {
  const stripped = filters.map((filter, index) => strip(filter, defaults[index]))
  return stripped.some((entry) => entry.changed) ? stripped.map((entry) => entry.filter) : undefined
}
