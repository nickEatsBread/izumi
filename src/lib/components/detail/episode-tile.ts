export type EpisodeTileKind = 'watched' | 'resume' | 'partial' | 'unwatched' | 'unaired'

export interface EpisodeTileState {
  kind: EpisodeTileKind
  /** Resume percentage, 0 unless `kind` is 'partial'. */
  percent: number
  playable: boolean
}

export interface EpisodeTileInput {
  ep: number
  /** Highest episode counted as finished. */
  watchedThrough: number
  /** Highest episode that has aired. */
  aired: number
  /** Stored playback position for this episode, 0-100. */
  percent: number
  /** The episode the series Play button opens (`data-next`, by the rule Continue Watching resumes by,
   *  `seriesResumeProgress`), the only one that can be the resume point. */
  resumeEpisode: number
}

/** Which visual state a number tile in the episode grid should carry. Mirrors the states the rich
 *  card already shows, so switching layouts never changes what the list is telling you. `resume` goes
 *  to the episode Play opens, the one `data-next` marks, while it is not started: never to the episode
 *  after the finished ones when Play (and Continue Watching) resume a later episode opened here, so a
 *  list never marks two episodes as where the viewer is up to. */
export function episodeTileState({ ep, watchedThrough, aired, percent, resumeEpisode }: EpisodeTileInput): EpisodeTileState {
  if (ep > aired) return { kind: 'unaired', percent: 0, playable: false }
  if (ep <= watchedThrough) return { kind: 'watched', percent: 0, playable: true }
  if (percent > 0) return { kind: 'partial', percent, playable: true }
  if (ep === resumeEpisode) return { kind: 'resume', percent: 0, playable: true }
  return { kind: 'unwatched', percent: 0, playable: true }
}

/** The highest episode that can play: the aired count capped at the last listed episode (an unknown
 *  count, `Infinity`, allows none); offline, the highest downloaded episode. The episode list and
 *  the series page both use it, so a Continue card and the Play button it replaces always agree. */
export function playableThrough(episodes: number[], airedTotal: number, offline: boolean): number {
  if (offline) return episodes.at(-1) ?? 0
  return Math.min(episodes.at(-1) ?? 0, Number.isFinite(airedTotal) ? airedTotal : 0)
}

/** Offline, the episode the series Play button opens: the first downloaded episode past `watched`
 *  (the progress the episode list shows), else the first download; 1 with nothing on disk. The
 *  Continue card and the list's `data-next` use it too, so all three name the same episode. */
export function offlineResumeEpisode(downloaded: number[], watched: number): number {
  return downloaded.find((episode) => episode > watched) ?? downloaded[0] ?? 1
}
