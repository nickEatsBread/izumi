import type { Media } from '$lib/anilist/types'
import { getSkipSegments, LABELS, mergeOverlapping, type Segment, type SkipType } from './aniskip'
import { getIntroDbSegments } from './introdb'

/** Keep AniSkip's release/runtime-aware anime timing when sources overlap, then let IntroDB fill
 * missing intros, recaps, and outros (including non-anime TV). */
export function mergeRemoteSkipSegments(primary: Segment[], fallback: Segment[]): Segment[] {
  const overlaps = (segment: Segment) => primary.some(
    (candidate) => segment.start < candidate.end && candidate.start < segment.end,
  )
  return [...primary, ...fallback.filter((segment) => !overlaps(segment))]
    .sort((left, right) => left.start - right.start)
}

const SOURCE_TYPES = new Map<unknown, SkipType>([['intro', 'op'], ['recap', 'recap'], ['credits', 'ed'], ['preview', 'preview']])
/** Longer than any file a source plays: a marker past it is not this episode's. */
const MAX_SOURCE_SECONDS = 12 * 60 * 60
/** An episode has a handful of markers; a longer list is not worth reading. */
const MAX_SOURCE_MARKERS = 32

/** The skip markers a source add-on sends with its stream (`izumi.skip`: `{ type, start, end }` in
 *  seconds, `type` one of intro, recap, credits, preview), as player segments. The list comes from
 *  an add-on, so anything that is not a known type with finite times inside a plausible file is
 *  dropped. */
export function sourceSkipSegments(raw: unknown): Segment[] {
  if (!Array.isArray(raw)) return []
  return mergeOverlapping(raw.slice(0, MAX_SOURCE_MARKERS).flatMap((marker): Segment[] => {
    const { type, start, end } = (marker && typeof marker === 'object' ? marker : {}) as Record<string, unknown>
    const kind = SOURCE_TYPES.get(type)
    if (!kind || typeof start !== 'number' || typeof end !== 'number') return []
    if (!(start >= 0 && end > start && end <= MAX_SOURCE_SECONDS)) return []
    return [{ start, end, type: kind, label: LABELS[kind], ...(type === 'credits' ? { credits: true as const } : {}) }]
  }))
}

/** The episode's skip segments. `own` are the playing stream's (`sourceSkipSegments`): they win
 *  where they overlap, and AniSkip then IntroDB only fill what they leave out. */
export async function getMediaSkipSegments(
  media: Media | null | undefined,
  episode: number | null | undefined,
  duration = 0,
  own: Segment[] = [],
): Promise<Segment[]> {
  const [aniskip, introdb] = await Promise.all([
    getSkipSegments(media?.idMal, episode, duration),
    getIntroDbSegments(media, episode, duration),
  ])
  return mergeRemoteSkipSegments(own, mergeRemoteSkipSegments(aniskip, introdb))
}
