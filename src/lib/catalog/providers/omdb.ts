import { get } from 'svelte/store'
import { phttp } from '$lib/net/http'
import { omdbApiKey } from '$lib/settings/catalog'
import type { Media, MediaRating } from '$lib/anilist/types'

const API = 'https://www.omdbapi.com/'

interface OmdbPayload {
  Response?: string
  imdbID?: string
  imdbRating?: string
  imdbVotes?: string
  Metascore?: string
  Ratings?: { Source?: string; Value?: string }[]
}

const sourceLabel = (source?: string) => source === 'Internet Movie Database'
  ? 'IMDb' : source === 'Rotten Tomatoes' ? 'Rotten Tomatoes' : source === 'Metacritic' ? 'Metacritic' : source

function parsedScore(value?: string): Pick<MediaRating, 'score' | 'scale'> | undefined {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(?:\/\s*(10|100)|%)?\s*$/.exec(value ?? '')
  if (!match) return undefined
  const score = Number(match[1])
  const scale = (match[2] ? Number(match[2]) : value?.includes('%') ? 100 : 10) as 10 | 100
  return Number.isFinite(score) && score >= 0 && score <= scale ? { score, scale } : undefined
}

export function parseOmdbRatings(payload: unknown): MediaRating[] {
  if (!payload || typeof payload !== 'object') return []
  const raw = payload as OmdbPayload
  if (raw.Response === 'False') return []
  const votesText = (raw.imdbVotes ?? '').replaceAll(',', '').trim()
  const votes = votesText ? Number(votesText) : undefined
  const ratings: MediaRating[] = (raw.Ratings ?? []).flatMap((entry) => {
    const source = sourceLabel(entry.Source)
    const value = parsedScore(entry.Value)
    return source && value ? [{ source, ...value, votes: source === 'IMDb' && Number.isFinite(votes) ? votes : undefined }] : []
  })
  if (!ratings.some((rating) => rating.source === 'IMDb')) {
    const value = parsedScore(raw.imdbRating)
    if (value) ratings.unshift({ source: 'IMDb', ...value, votes: Number.isFinite(votes) ? votes : undefined })
  }
  if (!ratings.some((rating) => rating.source === 'Metacritic')) {
    const value = parsedScore(raw.Metascore ? `${raw.Metascore}/100` : undefined)
    if (value) ratings.push({ source: 'Metacritic', ...value })
  }
  if (raw.imdbID) {
    const imdb = ratings.find((rating) => rating.source === 'IMDb')
    if (imdb) imdb.url = `https://www.imdb.com/title/${encodeURIComponent(raw.imdbID)}/`
  }
  return ratings
}

export async function enrichOmdbRatings(media: Media, signal?: AbortSignal): Promise<Media> {
  const key = get(omdbApiKey).trim()
  const imdbId = media.externalIds?.imdb
  if (!key || !imdbId) return media
  try {
    const url = new URL(API)
    url.searchParams.set('apikey', key)
    url.searchParams.set('i', imdbId)
    const response = await phttp(url.toString(), { signal, timeoutMs: 8_000, maxBytes: 256 * 1024 })
    if (!response.ok) return media
    const enriched = parseOmdbRatings(await response.json())
    if (!enriched.length) return media
    const sources = new Set(enriched.map((rating) => rating.source))
    return { ...media, ratings: [...enriched, ...(media.ratings ?? []).filter((rating) => !sources.has(rating.source))] }
  } catch {
    return media
  }
}
