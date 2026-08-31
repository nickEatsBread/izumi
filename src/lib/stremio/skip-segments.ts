import type { Media } from '$lib/anilist/types'
import { getSkipSegments, type Segment } from './aniskip'
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

export async function getMediaSkipSegments(
  media: Media | null | undefined,
  episode: number | null | undefined,
  duration = 0,
): Promise<Segment[]> {
  const [aniskip, introdb] = await Promise.all([
    getSkipSegments(media?.idMal, episode, duration),
    getIntroDbSegments(media, episode, duration),
  ])
  return mergeRemoteSkipSegments(aniskip, introdb)
}
