/** The episode a release search names, used to pick the file inside a season pack. */
export interface SearchEpisode {
  episode: number
  season?: number
}

const RESOLUTIONS = new Set([240, 360, 480, 576, 720, 1080, 1440, 2160])

/** Reads `S01E05`, `E05`, `ep 5`, `episode 5`, `season 2 05`, ` - 05` and a bare trailing number.
 *  Resolutions, years and codec numbers (`x265`, `10bit`) are never episodes. */
export function episodeFromSearch(text: string): SearchEpisode | undefined {
  let t = ` ${text.toLowerCase()} `
  const se = t.match(/\bs(\d{1,2})\s*e(\d{1,4})\b/)
  if (se) return { season: Number(se[1]), episode: Number(se[2]) }
  const seasonWord = t.match(/\bseason\s*(\d{1,2})\b/)
  const season = seasonWord ? Number(seasonWord[1]) : undefined
  if (seasonWord) t = t.replace(seasonWord[0], ' ')
  const named = t.match(/\b(?:e|ep|episode)\s*\.?\s*(\d{1,4})\b/)
  const bare = [...t.matchAll(/(?:\s|-)(\d{1,4})(?=\s)/g)]
    .map((match) => Number(match[1]))
    .filter((n) => n > 0 && (n < 1900 || n > 2099) && !RESOLUTIONS.has(n))
  const episode = named ? Number(named[1]) : bare[bare.length - 1]
  if (!episode) return undefined
  return season ? { season, episode } : { episode }
}
