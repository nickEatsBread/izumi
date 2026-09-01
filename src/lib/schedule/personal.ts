import type { Airing } from '$lib/anilist/schedule'
import type { Media, MediaVideo } from '$lib/anilist/types'
import { mediaRef } from '$lib/catalog/identity'
import { loadCatalogProvider } from '$lib/catalog/registry'
import { historyEntries, type HistoryEntry } from '$lib/player/history'

const SUPPORTED = new Set(['tmdb', 'stremio'])
const SERIES_LIMIT = 18
const MOVIE_SEED_LIMIT = 16
const DETAIL_TTL = 6 * 60 * 60 * 1000

export interface PersonalScheduleResult {
  airings: Airing[]
  historyCount: number
  movieSeedCount: number
  warning: string
}

export interface ReleaseMoment {
  airingAt: number
  timeKnown: boolean
}

/** Date-only provider values are deliberately shown at local noon without claiming an airtime. */
export function releaseMoment(value: string | undefined): ReleaseMoment | null {
  if (!value) return null
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (dateOnly) {
    const date = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 12)
    return Number.isNaN(date.getTime())
        || date.getFullYear() !== Number(dateOnly[1])
        || date.getMonth() !== Number(dateOnly[2]) - 1
        || date.getDate() !== Number(dateOnly[3])
      ? null
      : { airingAt: Math.floor(date.getTime() / 1000), timeKnown: false }
  }
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : { airingAt: Math.floor(parsed / 1000), timeKnown: true }
}

export function videoAirings(
  media: Media,
  videos: MediaVideo[],
  start: number,
  end: number,
): Airing[] {
  const source = media.catalog?.provider
  if (source !== 'tmdb' && source !== 'stremio') return []
  const seen = new Set<string>()
  return videos.flatMap((video) => {
    const moment = releaseMoment(video.released)
    if (!moment || moment.airingAt < start || moment.airingAt >= end) return []
    const providerEpisode = video.episode ?? video.number
    const key = `${video.id ?? ''}:${video.season ?? ''}:${providerEpisode}:${moment.airingAt}`
    if (seen.has(key)) return []
    seen.add(key)
    return [{
      ...moment,
      episode: video.number,
      season: video.season,
      providerEpisode,
      kind: 'episode' as const,
      source,
      media,
    }]
  })
}

function supportedEntry(entry: HistoryEntry): boolean {
  return !!entry.media.catalog && SUPPORTED.has(entry.media.catalog.provider)
}

function isMovie(media: Media): boolean {
  return media.catalog?.type === 'movie' || media.type === 'MOVIE' || media.format === 'MOVIE'
}

function uniqueVideos(videos: MediaVideo[]): MediaVideo[] {
  const seen = new Set<string>()
  return videos.filter((video) => {
    const key = `${video.id ?? ''}:${video.season ?? ''}:${video.episode ?? video.number}:${video.released ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const stremioDetailCache = new Map<string, { loadedAt: number; media: Media }>()

async function stremioSeriesMedia(media: Media, signal?: AbortSignal): Promise<Media> {
  const ref = mediaRef(media)
  const key = `${ref.provider}:${ref.type}:${ref.id}`
  const cached = stremioDetailCache.get(key)
  if (cached && Date.now() - cached.loadedAt < DETAIL_TTL) return cached.media
  try {
    const provider = await loadCatalogProvider('stremio')
    const detailed = await provider.detail(ref, signal)
    if (detailed) {
      stremioDetailCache.set(key, { loadedAt: Date.now(), media: detailed })
      return detailed
    }
  } catch (error) {
    if (signal?.aborted) throw error
  }
  return media
}

async function mapConcurrent<T, R>(
  values: T[],
  limit: number,
  fn: (value: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    for (;;) {
      const index = next++
      if (index >= values.length) return
      output[index] = await fn(values[index])
    }
  }))
  return output
}

/** Build a private, provider-aware week from durable watch history. */
export async function loadPersonalSchedule(
  history: Record<number, HistoryEntry>,
  start: number,
  end: number,
  signal?: AbortSignal,
): Promise<PersonalScheduleResult> {
  const supported = historyEntries(history).filter(supportedEntry)
  const series = supported.filter((entry) => !isMovie(entry.media)).slice(0, SERIES_LIMIT)
  const movieSeeds = supported.filter((entry) => isMovie(entry.media)).slice(0, MOVIE_SEED_LIMIT)

  const episodeGroups = await mapConcurrent(series, 4, async ({ media }) => {
    if (media.catalog?.provider === 'stremio') {
      const detailed = await stremioSeriesMedia(media, signal)
      return videoAirings(detailed, uniqueVideos([...(media.videos ?? []), ...(detailed.videos ?? [])]), start, end)
    }
    try {
      const { tmdbSeriesAiringHints } = await import('$lib/catalog/providers/tmdb')
      const hints = await tmdbSeriesAiringHints(media.catalog?.id ?? '', signal)
      return videoAirings(media, uniqueVideos([...(media.videos ?? []), ...hints]), start, end)
    } catch (error) {
      if (signal?.aborted) throw error
      return videoAirings(media, media.videos ?? [], start, end)
    }
  })

  let warning = ''
  let movieAirings: Airing[] = []
  if (movieSeeds.length) {
    try {
      const { tmdbMovieReleasesForTaste } = await import('$lib/catalog/providers/tmdb')
      const releases = await tmdbMovieReleasesForTaste(movieSeeds.map((entry) => entry.media), start, end, signal)
      movieAirings = releases.flatMap(({ media, matchingGenres }) => {
        const moment = releaseMoment(media.releaseDate)
        if (!moment || moment.airingAt < start || moment.airingAt >= end) return []
        return [{
          ...moment,
          episode: 1,
          kind: 'movie' as const,
          source: 'tmdb' as const,
          media,
          context: matchingGenres[0]
            ? `Matches your ${matchingGenres[0]} history`
            : 'Picked from your movie history',
        }]
      })
    } catch (error) {
      if (signal?.aborted) throw error
      warning = error instanceof Error && error.name === 'CatalogConfigurationError'
        ? 'Add a TMDB Read Access Token in Catalog settings to include movie premieres.'
        : 'Movie premiere matches are temporarily unavailable.'
    }
  }

  const seen = new Set<string>()
  const airings = [...episodeGroups.flat(), ...movieAirings]
    .filter((item) => {
      const ref = mediaRef(item.media)
      const key = `${ref.provider}:${ref.id}:${item.kind}:${item.episode}:${item.airingAt}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((left, right) => left.airingAt - right.airingAt)

  return { airings, historyCount: supported.length, movieSeedCount: movieSeeds.length, warning }
}
