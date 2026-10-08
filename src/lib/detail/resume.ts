// Where the series page's Play button picks a series up: the episode Continue Watching names. The
// watched marks of the episode list stay the episodes actually finished (animeWatchedProgress); only
// the episode Play opens, the list's opening page and its Continue card follow this count.
import type { Media } from '$lib/anilist/types'
import { animeWatchedProgress } from '$lib/catalog/anime-detail'
import { anilistIdOf } from '$lib/catalog/identity'
import { historyResumeProgress, type HistoryEntry } from '$lib/player/history'
import type { Pos } from '$lib/player/progress'

/** A provider card and its mapped AniList id share one history, as everywhere on the series page. */
const progressIds = (media: Media): number[] => {
  const canonical = anilistIdOf(media)
  return canonical == null ? [media.id] : [...new Set([media.id, canonical])]
}

/** The watched count the series resumes after: the episodes finished (list, trackers, this device),
 *  or, as Continue Watching counts it, the episode last opened here less one, so an episode opened but
 *  not finished is the one Play opens. An exact count chosen from the episode tools wins outright, as
 *  it does for the watched marks. */
export function seriesResumeProgress(
  media: Media,
  history: Record<number, Pick<HistoryEntry, 'progress' | 'episode'>>,
  session: Record<number, number>,
  overrides: Record<number, number>,
): number {
  const ids = progressIds(media)
  for (const id of ids) if (overrides[id] != null) return overrides[id]
  const finished = animeWatchedProgress(media, history, session, overrides)
  // A malformed entry (no episode number) adds nothing rather than poisoning the count.
  const opened = Math.max(0, ...ids.map((id) => (history[id] ? historyResumeProgress(history[id]) : 0)).filter(Number.isFinite))
  return Math.max(finished, opened)
}

/** Whether the series is under way, which the Play button's `resume` state, its Continue wording and
 *  the progress row follow: an episode finished or opened past the first (`resumeThrough`, from
 *  `seriesResumeProgress`), or a saved position in the episode Play opens. The position covers an
 *  episode 1 left part-way, which counts nothing as watched yet still resumes where it stopped, as its
 *  Continue Watching card does. A cleared position (the episode was finished) adds nothing. */
export function seriesUnderWay(resumeThrough: number, position?: Pos): boolean {
  return resumeThrough > 0 || (!!position && !position.cleared && position.pos > 0)
}

/** The share of a series watched, 0–1, for a progress row: the episodes before the one Play opens,
 *  plus how far into that one the viewer got, over the episode count; everything once the episodes
 *  watched reach it. Nothing without a count. */
export function seriesFraction(resumeEpisode: number, watched: number, episodeShare: number, total: number): number | undefined {
  if (!(total > 0)) return undefined
  const through = Math.max(watched, resumeEpisode - 1 + Math.max(0, Math.min(1, episodeShare)))
  return Math.max(0, Math.min(1, through / total))
}
