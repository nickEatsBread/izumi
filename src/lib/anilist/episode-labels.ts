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

/** One-line label used by Continue Watching. */
export function episodeSummary(episode: number, title: string | undefined, conceal: boolean): string {
  return conceal ? `Episode ${episode}` : (title || `Episode ${episode}`)
}
