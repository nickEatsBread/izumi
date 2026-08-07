import type { Stream } from './parse'

// User-declared source trust: an ORDERED list of origin ids, most-trusted first.
//
// Ranking already has opinions (resolution, seeders, cache state, curated releases, the group the
// previous episode played from), but every one of them is a heuristic about the FILE. None of them
// can express "this provider works for me and that one serves me 480p" — the single thing a user
// actually knows after a week of use. This is that statement, and nothing more: deliberately an
// order plus one mode, not a set of tunable score weights, which nobody can reason about.

/** The origin a row came from. Addons, torrent extensions and online extensions all carry one. */
export const originIdOf = (s: Stream): string | undefined => s.__origin?.id

/** Position in the user's trust order, or -1 when unlisted. */
export function priorityIndexOf(s: Stream, priority: readonly string[]): number {
  const id = originIdOf(s)
  return id ? priority.indexOf(id) : -1
}

// Points for a trusted source, by position. Sized to beat the resolution spread (2160p earns 25
// over 1080p's 20) so a preferred source genuinely wins its tier — that is what preferring one
// means. It cannot outrank CACHE state or a language mismatch: rankInfos sorts on those before it
// ever reaches the score, so this can never drag the user into a debrid download or a foreign dub.
const PRIORITY_TOP = 30
const PRIORITY_STEP = 6
const PRIORITY_FLOOR = 6

/** Score bonus for a row's position in the trust order. 0 when unlisted. */
export function priorityPoints(index: number): number {
  if (index < 0) return 0
  return Math.max(PRIORITY_FLOOR, PRIORITY_TOP - index * PRIORITY_STEP)
}

export type SourcePriorityMode = 'prefer' | 'strict'

/** Whether a row may be used at all.
 *
 *  `prefer` keeps everything — the order is a ranking opinion, and a source the user never listed
 *  is still better than no episode. `strict` is the one case where an empty list of sources is the
 *  CORRECT answer: the user excluded the rest on purpose, and quietly playing one anyway would
 *  make the setting a lie. A row with no origin at all is unlisted by definition. */
export function allowedByPriority(
  s: Stream, priority: readonly string[], mode: SourcePriorityMode,
): boolean {
  if (mode !== 'strict' || !priority.length) return true
  return priorityIndexOf(s, priority) >= 0
}

/** Filter a result set for `strict`. Returns the input untouched in `prefer` mode, or when the
 *  user has declared no trust order at all (an empty list means "no opinion", never "nothing"). */
export function applyPriorityFilter(
  streams: Stream[], priority: readonly string[], mode: SourcePriorityMode,
): Stream[] {
  if (mode !== 'strict' || !priority.length) return streams
  return streams.filter((s) => allowedByPriority(s, priority, mode))
}
