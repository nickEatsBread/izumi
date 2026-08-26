import { env as publicEnv } from '$env/dynamic/public'
import { get } from 'svelte/store'
import { phttp } from '$lib/net/http'
import { showAdult } from '$lib/settings/ui'
import { tmdbReadToken } from '$lib/settings/catalog'
import type { Media, MediaVideo } from '$lib/anilist/types'
import { compatibilityMediaId, type MediaRef } from '../identity'
import { CatalogConfigurationError, type CatalogHome, type CatalogHomeSection, type CatalogPage, type CatalogProvider, type CatalogSearchRequest } from '../types'

const API = 'https://api.themoviedb.org/3'
const IMAGE = 'https://image.tmdb.org/t/p'

type TmdbKind = 'movie' | 'tv'

interface TmdbListItem {
  id?: number
  media_type?: TmdbKind | 'person'
  title?: string
  name?: string
  original_title?: string
  original_name?: string
  overview?: string
  poster_path?: string | null
  backdrop_path?: string | null
  release_date?: string
  first_air_date?: string
  genre_ids?: number[]
  vote_average?: number
  vote_count?: number
  popularity?: number
  adult?: boolean
  origin_country?: string[]
  original_language?: string
}

interface TmdbPage {
  page?: number
  total_pages?: number
  total_results?: number
  results?: TmdbListItem[]
}

interface TmdbCredit {
  id?: number
  name?: string
  character?: string
  job?: string
  profile_path?: string | null
}

interface TmdbSeason {
  id?: number
  season_number?: number
  episode_count?: number
  name?: string
  air_date?: string | null
}

interface TmdbDetail extends TmdbListItem {
  status?: string
  runtime?: number
  episode_run_time?: number[]
  number_of_episodes?: number
  number_of_seasons?: number
  genres?: { id?: number; name?: string }[]
  production_companies?: { id?: number; name?: string }[]
  networks?: { id?: number; name?: string }[]
  seasons?: TmdbSeason[]
  external_ids?: { imdb_id?: string | null; tvdb_id?: number | null }
  videos?: { results?: { key?: string; site?: string; type?: string; official?: boolean }[] }
  credits?: { cast?: TmdbCredit[]; crew?: TmdbCredit[] }
  aggregate_credits?: { cast?: TmdbCredit[]; crew?: TmdbCredit[] }
  recommendations?: TmdbPage
  similar?: TmdbPage
}

interface TmdbSeasonDetail {
  season_number?: number
  episodes?: {
    id?: number
    episode_number?: number
    name?: string
    overview?: string
    still_path?: string | null
    air_date?: string | null
  }[]
}

const token = () => get(tmdbReadToken).trim()
  || (publicEnv as Record<string, string | undefined>).PUBLIC_TMDB_READ_TOKEN?.trim()
  || ''

async function tmdb<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}, signal?: AbortSignal): Promise<T> {
  const credential = token()
  if (!credential) throw new CatalogConfigurationError('TMDB needs a Read Access Token. Add one in Settings → Catalog.')
  const url = new URL(`${API}${path}`)
  for (const [key, value] of Object.entries(params)) if (value != null && value !== '') url.searchParams.set(key, String(value))
  const response = await phttp(url.toString(), {
    signal,
    timeoutMs: 15_000,
    maxBytes: 4 * 1024 * 1024,
    headers: { Authorization: `Bearer ${credential}`, Accept: 'application/json' },
  })
  if (!response.ok) {
    if (response.status === 401) throw new CatalogConfigurationError('TMDB rejected the Read Access Token in Settings → Catalog.')
    throw new Error(`TMDB returned HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
}

const image = (path: string | null | undefined, size: string) => path ? `${IMAGE}/${size}${path}` : undefined
const yearOf = (date?: string) => /^\d{4}/.exec(date ?? '')?.[0]

function status(value?: string): string | undefined {
  return ({
    'Returning Series': 'RELEASING', 'In Production': 'RELEASING', Planned: 'NOT_YET_RELEASED',
    Pilot: 'NOT_YET_RELEASED', Ended: 'FINISHED', Released: 'FINISHED', Canceled: 'CANCELLED',
  } as Record<string, string>)[value ?? '']
}

export function mapTmdb(raw: TmdbListItem, kind: TmdbKind): Media | null {
  if (raw.id == null || raw.media_type === 'person') return null
  const ref = { provider: 'tmdb' as const, type: kind === 'movie' ? 'movie' as const : 'series' as const, id: String(raw.id) }
  const date = kind === 'movie' ? raw.release_date : raw.first_air_date
  const title = raw.title ?? raw.name ?? raw.original_title ?? raw.original_name ?? 'Unknown title'
  return {
    id: compatibilityMediaId(ref),
    catalog: ref,
    externalIds: { tmdb: raw.id },
    type: kind === 'movie' ? 'MOVIE' : 'SERIES',
    title: {
      english: raw.title ?? raw.name,
      native: raw.original_title ?? raw.original_name,
      romaji: raw.original_title ?? raw.original_name ?? title,
      userPreferred: title,
    },
    description: raw.overview,
    format: kind === 'movie' ? 'MOVIE' : 'TV',
    episodes: kind === 'movie' ? 1 : undefined,
    averageScore: raw.vote_average != null ? Math.round(raw.vote_average * 10) : undefined,
    popularity: raw.popularity != null ? Math.round(raw.popularity) : undefined,
    startDate: yearOf(date) ? { year: Number(yearOf(date)) } : undefined,
    countryOfOrigin: raw.origin_country?.[0],
    coverImage: {
      extraLarge: image(raw.poster_path, 'w780'),
      large: image(raw.poster_path, 'w342'),
      medium: image(raw.poster_path, 'w185'),
    },
    bannerImage: image(raw.backdrop_path, 'original'),
    isAdult: !!raw.adult,
  }
}

function mapList(page: TmdbPage, forcedKind?: TmdbKind): Media[] {
  return (page.results ?? []).flatMap((item) => {
    const kind = forcedKind ?? item.media_type
    if (kind !== 'movie' && kind !== 'tv') return []
    const media = mapTmdb(item, kind)
    return !media || (!get(showAdult) && media.isAdult) ? [] : [media]
  })
}

async function list(path: string, kind: TmdbKind | undefined, signal?: AbortSignal, params: Record<string, string | number | boolean | undefined> = {}): Promise<Media[]> {
  const page = await tmdb<TmdbPage>(path, { include_adult: get(showAdult), language: 'en-GB', page: 1, ...params }, signal)
  return mapList(page, kind)
}

async function home(signal?: AbortSignal): Promise<CatalogHome> {
  const [trending, animeSeries, animeMovies, movies, television, ratedMovies, ratedTelevision, upcoming] = await Promise.all([
    list('/trending/all/week', undefined, signal),
    list('/discover/tv', 'tv', signal, { sort_by: 'popularity.desc', with_genres: 16, with_origin_country: 'JP' }),
    list('/discover/movie', 'movie', signal, { sort_by: 'popularity.desc', with_genres: 16, with_original_language: 'ja' }),
    list('/movie/popular', 'movie', signal),
    list('/tv/popular', 'tv', signal),
    list('/movie/top_rated', 'movie', signal),
    list('/tv/top_rated', 'tv', signal),
    list('/movie/upcoming', 'movie', signal),
  ])
  const hero = trending.filter((media) => media.bannerImage)
  return {
    hero: (hero.length ? hero : trending).slice(0, 10),
    sections: ([
      { id: 'trending', title: 'Trending', media: trending, more: { sort: 'trending', type: 'all' } },
      { id: 'anime-series', title: 'Popular Anime Series', media: animeSeries, more: { sort: 'popular', type: 'anime' } },
      { id: 'anime-movies', title: 'Popular Anime Movies', media: animeMovies, more: { sort: 'popular', type: 'anime' } },
      { id: 'movies', title: 'Popular Movies', media: movies, more: { sort: 'popular', type: 'movie' } },
      { id: 'series', title: 'Popular Series', media: television, more: { sort: 'popular', type: 'series' } },
      { id: 'rated-movies', title: 'Top Rated Movies', media: ratedMovies, more: { sort: 'rating', type: 'movie' } },
      { id: 'rated-series', title: 'Top Rated Series', media: ratedTelevision, more: { sort: 'rating', type: 'series' } },
      { id: 'upcoming', title: 'Upcoming Movies', media: upcoming, more: { sort: 'recent', type: 'movie' } },
    ] satisfies CatalogHomeSection[]).filter((section) => section.media.length),
  }
}

const sortBy = (sort?: CatalogSearchRequest['sort']) => sort === 'rating' ? 'vote_average.desc'
  : sort === 'recent' ? 'primary_release_date.desc' : 'popularity.desc'

async function discover(kind: TmdbKind, request: CatalogSearchRequest, animeOnly = false): Promise<TmdbPage> {
  const genre = request.genre ? await genreId(kind, request.genre, request.signal) : undefined
  return tmdb<TmdbPage>(`/discover/${kind}`, {
    page: request.page ?? 1,
    include_adult: get(showAdult),
    language: 'en-GB',
    sort_by: sortBy(request.sort),
    with_genres: [animeOnly ? 16 : undefined, genre].filter((value) => value != null).join(',') || undefined,
    with_origin_country: animeOnly && kind === 'tv' ? 'JP' : undefined,
    with_original_language: animeOnly && kind === 'movie' ? 'ja' : undefined,
    ...(kind === 'movie'
      ? { primary_release_year: request.year }
      : { first_air_date_year: request.year }),
    'vote_count.gte': request.sort === 'rating' ? 100 : undefined,
  }, request.signal)
}

let genresPromise: Promise<{ movie: Map<string, number>; tv: Map<string, number> }> | null = null
async function genreMaps(signal?: AbortSignal) {
  if (!genresPromise) genresPromise = Promise.all([
    tmdb<{ genres?: { id?: number; name?: string }[] }>('/genre/movie/list', { language: 'en-GB' }, signal),
    tmdb<{ genres?: { id?: number; name?: string }[] }>('/genre/tv/list', { language: 'en-GB' }, signal),
  ]).then(([movie, tv]) => ({
    movie: new Map((movie.genres ?? []).flatMap((genre) => genre.id != null && genre.name ? [[genre.name.toLowerCase(), genre.id]] : [])),
    tv: new Map((tv.genres ?? []).flatMap((genre) => genre.id != null && genre.name ? [[genre.name.toLowerCase(), genre.id]] : [])),
  })).catch((error) => { genresPromise = null; throw error })
  return genresPromise
}

async function genreId(kind: TmdbKind, name: string, signal?: AbortSignal) {
  const maps = await genreMaps(signal)
  return maps[kind].get(name.toLowerCase())
}

async function search(request: CatalogSearchRequest): Promise<CatalogPage> {
  const pageNumber = Math.max(1, request.page ?? 1)
  let result: TmdbPage
  const query = request.query?.trim()
  if (query) {
    const path = request.type === 'movie' ? '/search/movie' : request.type === 'series' ? '/search/tv' : '/search/multi'
    result = await tmdb<TmdbPage>(path, {
      query, page: pageNumber, include_adult: get(showAdult), language: 'en-GB',
      year: request.type === 'movie' ? request.year : undefined,
      first_air_date_year: request.type === 'series' ? request.year : undefined,
    }, request.signal)
  } else if (request.type === 'movie' || request.type === 'series') {
    result = await discover(request.type === 'movie' ? 'movie' : 'tv', request)
  } else {
    const animeOnly = request.type === 'anime'
    const [movies, television] = await Promise.all([discover('movie', request, animeOnly), discover('tv', request, animeOnly)])
    result = {
      page: pageNumber,
      total_pages: Math.max(movies.total_pages ?? 1, television.total_pages ?? 1),
      total_results: (movies.total_results ?? 0) + (television.total_results ?? 0),
      results: [
        ...(movies.results ?? []).map((item) => ({ ...item, media_type: 'movie' as const })),
        ...(television.results ?? []).map((item) => ({ ...item, media_type: 'tv' as const })),
      ].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0)),
    }
  }
  const forced = request.type === 'movie' ? 'movie' : request.type === 'series' ? 'tv' : undefined
  if (query) result.results = await filterSearchResults(result.results ?? [], request, forced)
  return {
    media: mapList(result, forced),
    page: result.page ?? pageNumber,
    hasNextPage: (result.page ?? pageNumber) < (result.total_pages ?? 1),
    total: result.total_results,
  }
}

async function filterSearchResults(items: TmdbListItem[], request: CatalogSearchRequest, forcedKind?: TmdbKind): Promise<TmdbListItem[]> {
  const maps = request.genre ? await genreMaps(request.signal) : undefined
  const genre = request.genre?.toLowerCase()
  const animeOnly = request.type === 'anime'
  const filtered = items.filter((item) => {
    const kind = forcedKind ?? item.media_type
    if (kind !== 'movie' && kind !== 'tv') return false
    const date = kind === 'movie' ? item.release_date : item.first_air_date
    if (request.year && Number(yearOf(date)) !== request.year) return false
    if (genre) {
      const wanted = maps?.[kind].get(genre)
      if (wanted != null && !item.genre_ids?.includes(wanted)) return false
    }
    if (animeOnly && (!item.genre_ids?.includes(16)
      || (!(item.origin_country?.includes('JP')) && item.original_language !== 'ja'))) return false
    return true
  })
  return filtered.sort((left, right) => {
    if (request.sort === 'rating') return (right.vote_average ?? 0) - (left.vote_average ?? 0)
    if (request.sort === 'recent') {
      const leftDate = left.release_date ?? left.first_air_date ?? ''
      const rightDate = right.release_date ?? right.first_air_date ?? ''
      return rightDate.localeCompare(leftDate)
    }
    return (right.popularity ?? 0) - (left.popularity ?? 0)
  })
}

async function mapConcurrent<T, R>(values: T[], limit: number, fn: (value: T) => Promise<R>): Promise<R[]> {
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

async function televisionVideos(id: string, seasons: TmdbSeason[], signal?: AbortSignal): Promise<MediaVideo[]> {
  const numbered = seasons.filter((season) => season.season_number != null)
    // Keep specials accessible, but put season 0 after the numbered run so Play episode 1 starts
    // the actual series rather than an OVA/recap entry.
    .sort((a, b) => ((a.season_number || Number.MAX_SAFE_INTEGER) - (b.season_number || Number.MAX_SAFE_INTEGER)))
  const pages = await mapConcurrent(numbered, 4, (season) =>
    tmdb<TmdbSeasonDetail>(`/tv/${encodeURIComponent(id)}/season/${season.season_number}`, { language: 'en-GB' }, signal)
      .catch(() => ({ season_number: season.season_number, episodes: [] })))
  let number = 0
  return pages.flatMap((season) => (season.episodes ?? []).map((episode) => ({
    id: episode.id == null ? undefined : String(episode.id),
    number: ++number,
    season: season.season_number,
    episode: episode.episode_number,
    title: episode.name,
    overview: episode.overview,
    thumbnail: image(episode.still_path, 'w780'),
    released: episode.air_date ?? undefined,
  })))
}

function detailedMedia(raw: TmdbDetail, kind: TmdbKind): Media | null {
  const media = mapTmdb(raw, kind)
  if (!media) return null
  const credits = raw.aggregate_credits ?? raw.credits
  const trailer = raw.videos?.results?.find((video) => video.site === 'YouTube' && video.type === 'Trailer' && video.official)
    ?? raw.videos?.results?.find((video) => video.site === 'YouTube' && video.type === 'Trailer')
  media.status = status(raw.status)
  media.episodes = kind === 'movie' ? 1 : raw.number_of_episodes
  media.duration = raw.runtime ?? raw.episode_run_time?.[0]
  media.genres = (raw.genres ?? []).flatMap((genre) => genre.name ? [genre.name] : [])
  media.studios = { nodes: [...(raw.production_companies ?? []), ...(raw.networks ?? [])].flatMap((company) => company.name ? [{ id: company.id, name: company.name }] : []) }
  media.externalIds = {
    ...media.externalIds,
    imdb: raw.external_ids?.imdb_id ?? undefined,
    tvdb: raw.external_ids?.tvdb_id ?? undefined,
  }
  media.trailer = trailer?.key ? { id: trailer.key, site: 'youtube' } : null
  media.characters = { edges: (credits?.cast ?? []).slice(0, 20).flatMap((person) => person.id != null && person.name ? [{
    role: person.character ?? 'Cast',
    node: { id: person.id, name: { full: person.name }, image: { large: image(person.profile_path, 'w342') } },
  }] : []) }
  media.staff = { edges: (credits?.crew ?? []).slice(0, 20).flatMap((person) => person.id != null && person.name ? [{
    role: person.job ?? 'Crew',
    node: { id: person.id, name: { full: person.name }, image: { large: image(person.profile_path, 'w342') } },
  }] : []) }
  const recommendations = mapList(raw.recommendations ?? raw.similar ?? {}, kind)
  media.recommendations = { nodes: recommendations.map((item) => ({ mediaRecommendation: item })) }
  return media
}

async function detail(ref: MediaRef, signal?: AbortSignal): Promise<Media | null> {
  if (ref.provider !== 'tmdb' || (ref.type !== 'movie' && ref.type !== 'series')) return null
  const kind: TmdbKind = ref.type === 'movie' ? 'movie' : 'tv'
  const append = kind === 'movie'
    ? 'videos,credits,recommendations,similar,external_ids'
    : 'videos,aggregate_credits,recommendations,similar,external_ids'
  const raw = await tmdb<TmdbDetail>(`/${kind}/${encodeURIComponent(ref.id)}`, {
    language: 'en-GB', append_to_response: append,
  }, signal)
  const media = detailedMedia(raw, kind)
  if (!media) return null
  media.videos = kind === 'movie'
    ? [{ id: media.externalIds?.imdb ?? `tmdb:${ref.id}`, number: 1, title: media.title.userPreferred }]
    : await televisionVideos(ref.id, raw.seasons ?? [], signal)
  return media
}

async function genres(signal?: AbortSignal): Promise<string[]> {
  const maps = await genreMaps(signal)
  return [...new Set([...maps.movie.keys(), ...maps.tv.keys()])]
    .map((name) => name.replace(/\b\w/g, (letter) => letter.toUpperCase())).sort()
}

export const tmdbCatalog: CatalogProvider = {
  id: 'tmdb',
  label: 'TMDB',
  capabilities: {
    anime: true, movies: true, series: true, search: true, genres: true,
    episodes: true, cast: true, relations: true,
  },
  home,
  search,
  detail,
  genres,
}
