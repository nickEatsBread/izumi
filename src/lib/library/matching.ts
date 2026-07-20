import type { EpisodeGuess, LibraryMedia } from './types'

const VIDEO_EXT = /\.(?:mkv|mp4|avi|mov|webm|m4v|ts)$/i
const TECH_TOKEN = /\b(?:480p|576p|720p|1080p|1440p|2160p|4k|8k|x26[45]|h\.?26[45]|hevc|av1|aac|flac|opus|webrip|web[- .]?dl|bluray|bdrip|remux|multi(?:-?sub)?|dual[- ]?audio|10bit|8bit)\b/gi

export function normaliseTitle(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/['’]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Parse common scene/fansub, Plex and season-folder episode names without requiring one layout. */
export function parseEpisodeFilename(filename: string): EpisodeGuess {
  let stem = filename.replace(VIDEO_EXT, '')
  // A leading bracket is normally a release group; retain later brackets until episode parsing.
  stem = stem.replace(/^\s*\[[^\]]+\]\s*/, '')
  const patterns: Array<{ re: RegExp; season?: number; episode: number; index: number }> = []
  const add = (re: RegExp, seasonGroup: number | undefined, episodeGroup: number) => {
    const match = re.exec(stem)
    if (!match) return
    const episode = Number(match[episodeGroup])
    const season = seasonGroup == null ? undefined : Number(match[seasonGroup])
    if (episode > 0 && episode < 10_000) patterns.push({ re, season, episode, index: match.index })
  }
  add(/\bS(\d{1,2})\s*E(\d{1,4})(?:\b|v\d)/i, 1, 2)
  add(/\b(\d{1,2})x(\d{1,4})\b/i, 1, 2)
  add(/\b(?:episode|ep|e)\s*[-_. ]?(\d{1,4})(?:\b|v\d)/i, undefined, 1)
  add(/(?:^|\s)-\s*(\d{1,4})(?:\s|$|v\d)/i, undefined, 1)
  add(/\[(\d{1,4})(?:v\d)?\]/i, undefined, 1)
  add(/^(\d{1,4})(?:v\d)?$/i, undefined, 1)

  const hit = patterns.sort((a, b) => a.index - b.index)[0]
  let titlePart = hit ? stem.slice(0, hit.index) : stem
  // Season-folder style names sometimes spell the season before a simple episode marker.
  const namedSeason = titlePart.match(/(?:^|\s)(?:season|s)\s*(\d{1,2})\s*$/i)
  const season = hit?.season ?? (namedSeason ? Number(namedSeason[1]) : undefined)
  if (namedSeason) titlePart = titlePart.slice(0, namedSeason.index)
  titlePart = titlePart
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*(?:\d{3,4}p|x26[45]|hevc|av1|audio)[^)]*\)/gi, ' ')
    .replace(TECH_TOKEN, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/\s+-\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()

  // If only a bare filename was supplied, keep it useful for manual matching.
  const title = titlePart || stem.replace(/[._]+/g, ' ').trim()
  return {
    title,
    season,
    episode: hit?.episode,
    confidence: hit ? (title.length > 2 ? 0.9 : 0.55) : 0.3,
  }
}

function titleCandidates(media: LibraryMedia): string[] {
  return [media.title.userPreferred, media.title.english, media.title.romaji, media.title.native, ...(media.synonyms ?? [])]
    .filter((value): value is string => !!value)
}

function tokens(value: string): Set<string> {
  return new Set(normaliseTitle(value).split(' ').filter((token) => token.length > 1))
}

export function titleSimilarity(left: string, right: string): number {
  const a = normaliseTitle(left)
  const b = normaliseTitle(right)
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.startsWith(b) || b.startsWith(a)) return 0.88
  const at = tokens(a), bt = tokens(b)
  let overlap = 0
  for (const token of at) if (bt.has(token)) overlap++
  return (2 * overlap) / Math.max(1, at.size + bt.size)
}

export function scoreMediaMatch(guess: EpisodeGuess, media: LibraryMedia): number {
  const titleScore = Math.max(...titleCandidates(media).map((title) => titleSimilarity(guess.title, title)), 0)
  let seasonAdjustment = 0
  if (guess.season && guess.season > 1) {
    const titles = titleCandidates(media).map(normaliseTitle)
    const ordinal = `${guess.season}${guess.season === 2 ? 'nd' : guess.season === 3 ? 'rd' : 'th'}`
    const wanted = new RegExp(`(?:season|part) ${guess.season}\\b|\\b${ordinal} season\\b`)
    if (titles.some((title) => wanted.test(title))) seasonAdjustment = 0.2
    else seasonAdjustment = titles.some((title) => /(?:season|part) \d+\b|\b\d+(?:st|nd|rd|th) season\b/.test(title)) ? -0.2 : -0.08
  }
  return Math.max(0, Math.min(1, titleScore * 0.8 + guess.confidence * 0.1 + 0.1 + seasonAdjustment))
}

export function bestMediaMatch(guess: EpisodeGuess, candidates: LibraryMedia[]) {
  return candidates
    .map((media) => ({ media, confidence: scoreMediaMatch(guess, media) }))
    .sort((left, right) => right.confidence - left.confidence)[0]
}
