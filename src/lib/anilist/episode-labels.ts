export interface EpisodeLabels {
  primary: string
  secondary: string
  concealSecondary: boolean
}

/** Arrange episode labels without exposing an unwatched title in the prominent text. */
export function episodeLabels(episode: number, title: string | undefined, conceal: boolean): EpisodeLabels {
  const generic = `Episode ${episode}`
  const actual = title || generic
  return conceal
    ? { primary: generic, secondary: actual, concealSecondary: actual !== generic }
    : { primary: actual, secondary: generic, concealSecondary: false }
}

/**
 * The number badge on an episode row. `absolute` is the series-wide count a multi-season show
 * carries alongside its per-season number; showing it is a DISPLAY preference (Settings →
 * Interface, off by default) and nothing else — episode resolution, playback and tracking always
 * work from `episode`. Falls back to the per-season number when there is no distinct series-wide
 * one to show, so a single-season list is never prefixed for no reason.
 */
export function episodeNumberLabel(episode: number, absolute: number | undefined, showAbsolute: boolean): string {
  return showAbsolute && absolute != null && absolute !== episode ? `A${absolute}` : String(episode)
}

/** One-line label used by Continue Watching. */
export function episodeSummary(episode: number, title: string | undefined, conceal: boolean): string {
  return conceal ? `Episode ${episode}` : (title || `Episode ${episode}`)
}
