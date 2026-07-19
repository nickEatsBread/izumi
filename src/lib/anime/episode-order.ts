/** Episode list sort direction. 'asc' = oldest first (default), 'desc' = newest first. */
export type SortDir = 'asc' | 'desc'

/** Return the episode numbers in the requested order, without mutating the input. */
export function orderEpisodes(eps: number[], dir: SortDir): number[] {
  return dir === 'desc' ? [...eps].reverse() : eps
}
