/** The episode a release search names, used to pick the file inside a season pack. */
export interface SearchEpisode {
  episode: number
  season?: number
}

/** Reads `S01E05`, `E05`, `ep 5`, `episode 5`, `season 2 05`, ` - 05` and a zero-padded `05`.
 *  A plain `12` is not read: numbers are too often part of a title, a cour or a bit depth, and
 *  the row label shows which episode a pack will play, so `ep 12` is one edit away. */
export function episodeFromSearch(text: string): SearchEpisode | undefined {
  let t = ` ${text.toLowerCase()} `
  const se = t.match(/\bs(\d{1,2})\s*e(\d{1,4})\b/)
  if (se) return Number(se[2]) ? { season: Number(se[1]), episode: Number(se[2]) } : undefined
  const seasonWord = t.match(/\bseason\s*(\d{1,2})\b/)
  const season = seasonWord ? Number(seasonWord[1]) : undefined
  if (seasonWord) t = t.replace(seasonWord[0], ' ')
  const named = t.match(/\b(?:e|ep|episode)\s*\.?\s*(\d{1,4})\b/)
  // ` - 05` (the anime release convention) or a zero-padded `05`; never a year.
  const marked = [...t.matchAll(/\s(?:-\s*(\d{1,4})|(0\d{1,3}))(?=\s)/g)]
    .map((match) => Number(match[1] ?? match[2]))
    .filter((n) => n > 0 && (n < 1900 || n > 2099))
  const episode = named ? Number(named[1]) : marked[marked.length - 1]
  if (!episode) return undefined
  return season ? { season, episode } : { episode }
}
