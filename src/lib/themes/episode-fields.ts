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

/** The day an unaired episode arrives, in the viewer's locale ("Saturday, October 31"): from its airing
 *  time (seconds) when the catalog has one, which alone decides, else from its air day ("2026-10-31",
 *  episode metadata). Nothing when neither is known or the episode is already due. */
export function arrivalDayText(airingAt: number | undefined, airDate: string | undefined, now = Date.now(), locale?: string): string | undefined {
  const words = { weekday: 'long', month: 'long', day: 'numeric' } as const
  if (airingAt) return airingAt * 1000 > now ? new Intl.DateTimeFormat(locale, words).format(new Date(airingAt * 1000)) : undefined
  const day = airDate ? /^(\d{4})-(\d{2})-(\d{2})/.exec(airDate) : null
  if (!day) return undefined
  // A calendar day: compared with the viewer's today and printed in UTC, so no time zone moves it.
  const date = Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]))
  const today = new Date(now)
  if (date < Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) return undefined
  return new Intl.DateTimeFormat(locale, { ...words, timeZone: 'UTC' }).format(date)
}

/** API 6 `upcoming`: "Coming Saturday, October 31" for an unaired episode whose day is known
 *  (arrivalDayText), "Coming soon" when it is not; nothing for a released episode. */
export function upcomingText(released: boolean, day: string | undefined): string | undefined {
  return released ? undefined : day ? `Coming ${day}` : 'Coming soon'
}
