// Text for an episode's number and rating fields in theme templates (API 3). Pure, so every host
// formats them the same way.

/** The printed episode number without a prefix ("12"). With series-wide numbering switched on it
 *  prints the series-wide number when the episode has one — the number badges mark that "A1071";
 *  a template brings its own prefix ("EP", "Episode"). */
export function episodeNoText(episode: number, absolute: number | undefined, showAbsolute: boolean): string {
  return String(showAbsolute && absolute != null ? absolute : episode)
}

/** The episode's own title (`episodeName`): nothing when it has none — the "Episode 12" a list
 *  prints in its place is not a title — or while spoiler protection hides it (`concealed`). */
export function episodeNameText(episode: number, title: string | undefined, concealed = false): string | undefined {
  const name = title?.trim()
  return !concealed && name && name !== `Episode ${episode}` ? name : undefined
}

/** "S2 E5" when the episode metadata knows its season, else "E5". `seasonEpisode` is the number
 *  within that season when it differs from the list's own (a split cour continues its season). */
export function episodeCodeText(episode: number, season?: number, seasonEpisode?: number): string {
  return season != null && season > 0 ? `S${season} E${seasonEpisode ?? episode}` : `E${episode}`
}

/** A released episode's rating out of ten with one decimal ("8.5"). Accepts both scales episode
 *  metadata uses (0–10, or a 0–100 percentage); nothing before release or without a rating. */
export function episodeRatingText(rating: number | undefined, released: boolean): string | undefined {
  if (!released || typeof rating !== 'number' || !Number.isFinite(rating) || rating <= 0) return undefined
  const outOfTen = rating > 10 ? rating / 10 : rating
  return (Math.round(Math.min(outOfTen, 10) * 10) / 10).toFixed(1)
}
