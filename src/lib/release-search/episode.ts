/** The episode a release search names, used to pick the file inside a season pack. */
export interface SearchEpisode {
  episode: number
  season?: number
}

/** Once a title is picked, a plain trailing number is its episode, unless the title itself carries
 *  that number (a "… 100" title) or it is a year. */
export function episodeForTitle(text: string, titleNames: string[]): SearchEpisode | undefined {
  const marked = episodeFromSearch(text)
  if (marked) return marked
  const bare = text.match(/\s(\d{1,4})\s*$/)?.[1]
  const episode = Number(bare)
  if (!bare || !episode || (episode >= 1900 && episode <= 2099)) return undefined
  const inTitle = new RegExp(`(^|\\D)${bare}(\\D|$)`)
  return titleNames.some((name) => inTitle.test(name)) ? undefined : { episode }
}

/** The title part of a release search, for matching it to a catalog title: episode, season and
 *  quality words are dropped (catalog search matches whole words, so `1080p` would sink it). */
export function titleFromSearch(text: string): string {
  return ` ${text} `
    .replace(/\bs\d{1,2}\s*e\d{1,4}\b|\bseason\s*\d{1,2}\b|\b(?:e|ep|episode)\s*\.?\s*\d{1,4}\b/gi, ' ')
    .replace(/\s-\s*\d{1,4}(?=\s)|\s0\d{1,3}(?=\s)/g, ' ')
    .replace(/\b(?:\d{3,4}p|4k|[xh]\.?26[45]|hevc|avc|av1|\d{1,2}[- ]?bit|web[- ]?(?:dl|rip)|bluray|bdrip)\b/gi, ' ')
    .replace(/[[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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
