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
}

/** Which visual state a number tile in the episode grid should carry. Mirrors the states the rich
 *  card already shows, so switching layouts never changes what the list is telling you. */
export function episodeTileState({ ep, watchedThrough, aired, percent }: EpisodeTileInput): EpisodeTileState {
  if (ep > aired) return { kind: 'unaired', percent: 0, playable: false }
  if (ep <= watchedThrough) return { kind: 'watched', percent: 0, playable: true }
  if (percent > 0) return { kind: 'partial', percent, playable: true }
  if (ep === watchedThrough + 1) return { kind: 'resume', percent: 0, playable: true }
  return { kind: 'unwatched', percent: 0, playable: true }
}

/** The highest episode that can play: the aired count capped at the last listed episode (an unknown
 *  count, `Infinity`, allows none); offline, the highest downloaded episode. The episode list and
 *  the series page both use it, so a Continue card and the Play button it replaces always agree. */
export function playableThrough(episodes: number[], airedTotal: number, offline: boolean): number {
  if (offline) return episodes.at(-1) ?? 0
  return Math.min(episodes.at(-1) ?? 0, Number.isFinite(airedTotal) ? airedTotal : 0)
}
