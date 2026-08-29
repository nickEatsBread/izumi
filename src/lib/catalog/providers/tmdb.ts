import { env as publicEnv } from '$env/dynamic/public'
import { get } from 'svelte/store'
import { phttp } from '$lib/net/http'
import { showAdult } from '$lib/settings/ui'
import { tmdbReadToken } from '$lib/settings/catalog'
import { CINEMETA_BASE } from '$lib/stremio/sources'
import type { Media, MediaRating, MediaVideo, MediaWatchProvider } from '$lib/anilist/types'
import { catalogHomeLayouts, resolveCatalogHomeRows } from '../home-layout'
import { TMDB_HOME_ROWS } from '../home-options'
import { compatibilityMediaId, type MediaRef } from '../identity'
import { CatalogConfigurationError, type CatalogHome, type CatalogHomeFeature, type CatalogHomeSection, type CatalogPage, type CatalogProvider, type CatalogSearchOptions, type CatalogSearchRequest } from '../types'
import { enrichOmdbRatings } from './omdb'
import { interleaveFeatured, rankFeaturedMedia } from '../featured-context'

const API = 'https://api.themoviedb.org/3'
const IMAGE = 'https://image.tmdb.org/t/p'
// en-US has TMDB's broadest English translation coverage. In particular, many anime entries have
// an en-US title but no en-GB title, in which case TMDB falls back to the Japanese original.
const TMDB_LANGUAGE = 'en-US'

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

interface TmdbLanguage {
  iso_639_1?: string
  english_name?: string
  name?: string
}

interface TmdbCountry {
  iso_3166_1?: string
  english_name?: string
  native_name?: string
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

interface TmdbImageFile {
  file_path?: string | null
  iso_639_1?: string | null
  vote_average?: number
  vote_count?: number
  width?: number
}

interface TmdbImages {
  logos?: TmdbImageFile[]
}

interface TmdbWatchProvider {
  provider_id?: number
  provider_name?: string
  logo_path?: string | null
  display_priority?: number
}

interface TmdbWatchProviderPage {
  results?: TmdbWatchProvider[]
}

interface TmdbCollection {
  id?: number
  name?: string
  poster_path?: string | null
  backdrop_path?: string | null
  parts?: TmdbListItem[]
}

interface TmdbWatchEntry {
  link?: string
  flatrate?: TmdbWatchProvider[]
  free?: TmdbWatchProvider[]
  ads?: TmdbWatchProvider[]
  rent?: TmdbWatchProvider[]
  buy?: TmdbWatchProvider[]
}

interface TmdbReleaseCountry {
  iso_3166_1?: string
  release_dates?: { certification?: string; type?: number }[]
}

interface TmdbContentRating {
  iso_3166_1?: string
  rating?: string
}

interface TmdbDetail extends TmdbListItem {
  tagline?: string
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
  images?: TmdbImages
  'watch/providers'?: { results?: Record<string, TmdbWatchEntry> }
  release_dates?: { results?: TmdbReleaseCountry[] }
  content_ratings?: { results?: TmdbContentRating[] }
  keywords?: { keywords?: { id?: number; name?: string }[]; results?: { id?: number; name?: string }[] }
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

export function tmdbRegion(locale?: string): string {
  try {
    return new Intl.Locale(locale || (typeof navigator !== 'undefined' ? navigator.language : 'en-US')).region ?? 'US'
  } catch {
    return 'US'
  }
}

function regionalValue<T extends { iso_3166_1?: string }>(values: T[], region: string): T | undefined {
  return values.find((value) => value.iso_3166_1 === region)
    ?? values.find((value) => value.iso_3166_1 === 'US')
    ?? values.find((value) => value.iso_3166_1 === 'GB')
    ?? values[0]
}

export function tmdbContentRating(raw: Pick<TmdbDetail, 'release_dates' | 'content_ratings'>, region: string): string | undefined {
  const television = regionalValue(raw.content_ratings?.results ?? [], region)?.rating?.trim()
  if (television) return television
  const releases = regionalValue(raw.release_dates?.results ?? [], region)?.release_dates ?? []
  return (releases.find((release) => release.type === 3 && release.certification?.trim())
    ?? releases.find((release) => release.certification?.trim()))?.certification?.trim() || undefined
}

export function tmdbWatchProviders(raw: TmdbDetail['watch/providers'], region: string): MediaWatchProvider[] {
  const results = raw?.results ?? {}
  const entry = results[region] ?? results.US ?? results.GB ?? Object.values(results)[0]
  if (!entry) return []
  const groups: [MediaWatchProvider['kind'], TmdbWatchProvider[] | undefined][] = [
    ['subscription', entry.flatrate], ['free', entry.free], ['ads', entry.ads], ['rent', entry.rent], ['buy', entry.buy],
  ]
  const seen = new Set<string>()
  return groups.flatMap(([kind, providers]) => (providers ?? []).flatMap((provider) => {
    if (!provider.provider_name) return []
    const key = String(provider.provider_id ?? provider.provider_name).toLowerCase()
    if (seen.has(key)) return []
    seen.add(key)
    return [{
      id: provider.provider_id,
      name: provider.provider_name,
      logoImage: image(provider.logo_path, 'w92'),
      kind,
      url: entry.link,
    } satisfies MediaWatchProvider]
  }))
}

export function parseCinemetaRating(value: unknown): MediaRating | undefined {
  const raw = value && typeof value === 'object'
    ? (value as { meta?: { imdbRating?: unknown } }).meta?.imdbRating
    : undefined
  const score = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN
  return Number.isFinite(score) && score > 0 && score <= 10 ? { source: 'IMDb', score, scale: 10 } : undefined
}

async function imdbRating(imdbId: string, kind: TmdbKind, signal?: AbortSignal): Promise<MediaRating | undefined> {
  try {
    const type = kind === 'movie' ? 'movie' : 'series'
    const response = await phttp(`${CINEMETA_BASE}/meta/${type}/${encodeURIComponent(imdbId)}.json`, {
      signal, timeoutMs: 8_000, maxBytes: 512 * 1024,
    })
    return response.ok ? parseCinemetaRating(await response.json()) : undefined
  } catch {
    return undefined
  }
}

/** Prefer an English title treatment, then language-neutral clear art. TMDB normally returns
 * results by popularity, but ranking explicitly keeps the choice deterministic across responses. */
export function pickTmdbLogo(images?: TmdbImages): string | undefined {
  const languageRank = (language?: string | null) => language === 'en' ? 2 : language == null ? 1 : 0
  const logo = [...(images?.logos ?? [])].filter((candidate) => !!candidate.file_path).sort((left, right) =>
    languageRank(right.iso_639_1) - languageRank(left.iso_639_1)
    || (right.vote_average ?? 0) - (left.vote_average ?? 0)
    || (right.vote_count ?? 0) - (left.vote_count ?? 0)
    || (right.width ?? 0) - (left.width ?? 0))[0]
  return image(logo?.file_path, 'w500')
}

const logoRequests = new Map<string, Promise<string | undefined>>()

function tmdbLogo(kind: TmdbKind, id: string, signal?: AbortSignal): Promise<string | undefined> {
  const key = `${kind}:${id}`
  const existing = logoRequests.get(key)
  if (existing) return existing
  const request = tmdb<TmdbImages>(`/${kind}/${encodeURIComponent(id)}/images`, {
    language: TMDB_LANGUAGE, include_image_language: 'en,null',
  }, signal).then(pickTmdbLogo).catch((error) => {
    logoRequests.delete(key)
    throw error
  })
  logoRequests.set(key, request)
  return request
}

async function withTmdbLogo(media: Media, signal?: AbortSignal): Promise<Media> {
  const ref = media.catalog
  if (ref?.provider !== 'tmdb' || (ref.type !== 'movie' && ref.type !== 'series')) return media
  const kind: TmdbKind = ref.type === 'movie' ? 'movie' : 'tv'
  try {
    const logoImage = await tmdbLogo(kind, ref.id, signal)
    return logoImage ? { ...media, logoImage } : media
  } catch {
    // Logos are enhancement artwork. A missing/failed image request must never remove the hero.
    return media
  }
}

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
  const englishTitle = raw.title ?? raw.name
  const originalTitle = raw.original_title ?? raw.original_name
  const title = englishTitle ?? originalTitle ?? 'Unknown title'
  const rating = raw.vote_average != null && raw.vote_average > 0
    ? { source: 'TMDB', score: raw.vote_average, scale: 10 as const, votes: raw.vote_count }
    : undefined
  return {
    id: compatibilityMediaId(ref),
    catalog: ref,
    externalIds: { tmdb: raw.id },
    type: kind === 'movie' ? 'MOVIE' : 'SERIES',
    title: {
      english: englishTitle,
      native: originalTitle,
      // The global Romaji preference is meaningful for anime-native providers, but TMDB only
      // supplies localized and original-script names. Keep TMDB cards on the English-localized
      // name instead of treating a Japanese original_name as if it were Romaji.
      romaji: englishTitle ?? originalTitle,
      userPreferred: title,
    },
    description: raw.overview,
    format: kind === 'movie' ? 'MOVIE' : 'TV',
    episodes: kind === 'movie' ? 1 : undefined,
    averageScore: raw.vote_average != null ? Math.round(raw.vote_average * 10) : undefined,
    ratings: rating ? [rating] : undefined,
    popularity: raw.popularity != null ? Math.round(raw.popularity) : undefined,
    startDate: yearOf(date) ? { year: Number(yearOf(date)) } : undefined,
    countryOfOrigin: raw.origin_country?.[0],
    originalLanguage: raw.original_language,
    releaseDate: date,
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
  const page = await tmdb<TmdbPage>(path, { include_adult: get(showAdult), language: TMDB_LANGUAGE, page: 1, ...params }, signal)
  return mapList(page, kind)
}

interface TmdbHomeRequest {
  id: string
  path: string
  kind?: TmdbKind
  params?: Record<string, string | number | boolean | undefined>
  more?: CatalogHomeSection['more']
  limit?: number
  presentation?: CatalogHomeSection['presentation']
}

const movieGenre = (id: string, genre: number, name: string): TmdbHomeRequest => ({
  id, path: '/discover/movie', kind: 'movie',
  params: { sort_by: 'popularity.desc', with_genres: genre },
  more: { type: 'movie', genre: name, sort: 'popular' },
})
const seriesGenre = (id: string, genre: number, name: string): TmdbHomeRequest => ({
  id, path: '/discover/tv', kind: 'tv',
  params: { sort_by: 'popularity.desc', with_genres: genre },
  more: { type: 'series', genre: name, sort: 'popular' },
})

/** Preset ids are stable storage keys. Numeric genre ids are TMDB's documented movie/TV genre
 * ids; using discover here gives users useful rows without exposing a fragile raw query editor. */
const TMDB_HOME_REQUESTS: TmdbHomeRequest[] = [
  { id: 'trending', path: '/trending/all/week', more: { sort: 'trending', type: 'all' } },
  { id: 'trending-today', path: '/trending/all/day', more: { sort: 'trending', type: 'all' } },
  { id: 'trending-movies', path: '/trending/movie/week', kind: 'movie', more: { sort: 'trending', type: 'movie' } },
  { id: 'trending-movies-today', path: '/trending/movie/day', kind: 'movie', more: { sort: 'trending', type: 'movie' } },
  { id: 'trending-series', path: '/trending/tv/week', kind: 'tv', more: { sort: 'trending', type: 'series' } },
  { id: 'trending-series-today', path: '/trending/tv/day', kind: 'tv', more: { sort: 'trending', type: 'series' } },
  { id: 'top10-movies', path: '/discover/movie', kind: 'movie', limit: 10, presentation: 'ranked', params: {
    sort_by: 'popularity.desc', with_watch_monetization_types: 'flatrate|free|ads',
  } },

  { id: 'movies', path: '/movie/popular', kind: 'movie', more: { sort: 'popular', type: 'movie' } },
  { id: 'rated-movies', path: '/movie/top_rated', kind: 'movie', more: { sort: 'rating', type: 'movie' } },
  { id: 'upcoming', path: '/movie/upcoming', kind: 'movie', more: { sort: 'recent', type: 'movie' } },
  { id: 'now-playing', path: '/movie/now_playing', kind: 'movie', more: { sort: 'recent', type: 'movie' } },
  movieGenre('action-movies', 28, 'Action'),
  movieGenre('adventure-movies', 12, 'Adventure'),
  movieGenre('comedy-movies', 35, 'Comedy'),
  movieGenre('crime-movies', 80, 'Crime'),
  movieGenre('documentary-movies', 99, 'Documentary'),
  movieGenre('family-movies', 10751, 'Family'),
  movieGenre('fantasy-movies', 14, 'Fantasy'),
  movieGenre('horror-movies', 27, 'Horror'),
  movieGenre('romance-movies', 10749, 'Romance'),
  movieGenre('sci-fi-movies', 878, 'Science Fiction'),
  movieGenre('thriller-movies', 53, 'Thriller'),

  { id: 'series', path: '/tv/popular', kind: 'tv', more: { sort: 'popular', type: 'series' } },
  { id: 'rated-series', path: '/tv/top_rated', kind: 'tv', more: { sort: 'rating', type: 'series' } },
  { id: 'on-the-air', path: '/tv/on_the_air', kind: 'tv', more: { sort: 'recent', type: 'series' } },
  { id: 'airing-today', path: '/tv/airing_today', kind: 'tv', more: { sort: 'recent', type: 'series' } },
  seriesGenre('comedy-series', 35, 'Comedy'),
  seriesGenre('crime-series', 80, 'Crime'),
  seriesGenre('documentary-series', 99, 'Documentary'),
  seriesGenre('drama-series', 18, 'Drama'),
  seriesGenre('family-series', 10751, 'Family'),
  seriesGenre('mystery-series', 9648, 'Mystery'),
  seriesGenre('reality-series', 10764, 'Reality'),
  seriesGenre('sci-fi-fantasy-series', 10765, 'Sci-Fi & Fantasy'),

  { id: 'anime-series', path: '/discover/tv', kind: 'tv', params: { sort_by: 'popularity.desc', with_genres: 16, with_origin_country: 'JP' }, more: { sort: 'popular', type: 'anime' } },
  { id: 'anime-movies', path: '/discover/movie', kind: 'movie', params: { sort_by: 'popularity.desc', with_genres: 16, with_original_language: 'ja' }, more: { sort: 'popular', type: 'anime' } },
  { id: 'rated-anime-series', path: '/discover/tv', kind: 'tv', params: { sort_by: 'vote_average.desc', with_genres: 16, with_origin_country: 'JP', 'vote_count.gte': 100 }, more: { sort: 'rating', type: 'anime' } },
  { id: 'rated-anime-movies', path: '/discover/movie', kind: 'movie', params: { sort_by: 'vote_average.desc', with_genres: 16, with_original_language: 'ja', 'vote_count.gte': 100 }, more: { sort: 'rating', type: 'anime' } },
]

const FEATURED_COLLECTION_IDS = [10, 1241, 119, 86311, 328, 10194]

export function tmdbRegionName(region: string): string {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(region) ?? region }
  catch { return region }
}

async function collectionFeatures(signal?: AbortSignal): Promise<CatalogHomeFeature[]> {
  const collections = await mapConcurrent(FEATURED_COLLECTION_IDS, 4, (id) =>
    tmdb<TmdbCollection>(`/collection/${id}`, { language: TMDB_LANGUAGE }, signal).catch(() => null))
  return collections.flatMap((collection) => {
    if (!collection?.id || !collection.name) return []
    const title = collection.name.replace(/\s+Collection$/i, '')
    const count = collection.parts?.filter((part) => part.id != null).length ?? 0
    return [{
      id: String(collection.id), title,
      image: image(collection.backdrop_path ?? collection.poster_path, 'w1280'),
      subtitle: count ? `${count} film${count === 1 ? '' : 's'}` : undefined,
      href: `/app/search?provider=tmdb&type=movie&search=${encodeURIComponent(title)}`,
    } satisfies CatalogHomeFeature]
  })
}

async function streamingProviderFeatures(region: string, signal?: AbortSignal): Promise<CatalogHomeFeature[]> {
  const page = await tmdb<TmdbWatchProviderPage>('/watch/providers/movie', {
    language: TMDB_LANGUAGE, watch_region: region,
  }, signal)
  return [...(page.results ?? [])]
    .filter((provider) => provider.provider_id != null && !!provider.provider_name && !!provider.logo_path)
    .sort((left, right) => (left.display_priority ?? 999) - (right.display_priority ?? 999))
    .slice(0, 16)
    .map((provider) => ({
      id: String(provider.provider_id),
      title: provider.provider_name!,
      image: image(provider.logo_path, 'w185'),
      href: `/app/search?provider=tmdb&type=movie&watchProvider=${provider.provider_id}&watchProviderName=${encodeURIComponent(provider.provider_name!)}`,
    }))
}

async function home(signal?: AbortSignal, rowIds?: string[]): Promise<CatalogHome> {
  const configured = rowIds
    ? TMDB_HOME_ROWS.map((row) => ({ ...row, enabled: rowIds.includes(row.id) }))
    : resolveCatalogHomeRows('tmdb', TMDB_HOME_ROWS, get(catalogHomeLayouts))
  const selected = configured.filter((row) => row.enabled && row.id !== 'continue')
  const region = tmdbRegion()
  const requests = new Map(TMDB_HOME_REQUESTS.map((request) => [request.id, request]))
  // The daily movie and series lists supply an explainable featured mix. Keep the weekly all-media
  // request for its visible carousel, but never describe its cross-type positions as movie ranks.
  const fetchIds = [...new Set([
    ...selected.map((row) => row.id),
    'trending-movies-today',
    'trending-series-today',
  ])]
  const [loaded, collections, providers] = await Promise.all([
    mapConcurrent(fetchIds.flatMap((id) => requests.get(id) ?? []), 6, async (request) => {
      const media = await list(request.path, request.kind, signal, request.id === 'top10-movies' ? {
        ...request.params, region, watch_region: region,
      } : request.params).catch((error) => {
        if (error instanceof CatalogConfigurationError || signal?.aborted) throw error
        return []
      })
      return { request, media: request.limit ? media.slice(0, request.limit) : media }
    }),
    selected.some((row) => row.id === 'collections') ? collectionFeatures(signal) : [],
    selected.some((row) => row.id === 'streaming-providers')
      ? streamingProviderFeatures(region, signal).catch(() => []) : [],
  ])
  const mediaById = new Map(loaded.map(({ request, media }) => [request.id, media]))
  const rankedMovies = rankFeaturedMedia(mediaById.get('trending-movies-today') ?? [], 'Movies Today')
  const rankedSeries = rankFeaturedMedia(mediaById.get('trending-series-today') ?? [], 'TV Today')
  const daily = interleaveFeatured([rankedMovies, rankedSeries], 20)
  const heroCandidates = daily.filter((media) => media.bannerImage)
  const hero = await mapConcurrent((heroCandidates.length ? heroCandidates : daily).slice(0, 10), 4,
    (media) => withTmdbLogo(media, signal))
  return {
    hero,
    sections: selected.flatMap((row): CatalogHomeSection[] => {
      if (row.id === 'collections') return collections.length ? [{
        id: row.id, title: row.title, media: [], presentation: 'collections', features: collections,
      } satisfies CatalogHomeSection] : []
      if (row.id === 'streaming-providers') return providers.length ? [{
        id: row.id, title: row.title, media: [], presentation: 'providers', features: providers,
        attribution: 'Availability by JustWatch',
      } satisfies CatalogHomeSection] : []
      const request = requests.get(row.id)
      const media = mediaById.get(row.id) ?? []
      const title = row.id === 'top10-movies'
        ? `Top 10 Movies Streaming in ${tmdbRegionName(region)}` : row.title
      return request && media.length ? [{
        id: row.id, title, media, more: request.more, presentation: request.presentation,
      } satisfies CatalogHomeSection] : []
    }),
  }
}

const sortBy = (kind: TmdbKind, sort?: CatalogSearchRequest['sort']) => sort === 'rating' ? 'vote_average.desc'
  : sort === 'recent' ? (kind === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc')
  : sort === 'oldest' ? (kind === 'movie' ? 'primary_release_date.asc' : 'first_air_date.asc')
  : sort === 'title' ? (kind === 'movie' ? 'original_title.asc' : 'original_name.asc')
  : 'popularity.desc'

/** Translate Izumi's provider-neutral filters to TMDB Discover parameters. Exported so the
 * important scale conversion (0–100 UI score to TMDB's 0–10 score) stays regression-tested. */
export function tmdbDiscoverFilterParams(
  kind: TmdbKind,
  request: CatalogSearchRequest,
  genre?: number,
  animeOnly = false,
): Record<string, string | number | boolean | undefined> {
  return {
    page: request.page ?? 1,
    include_adult: get(showAdult),
    language: TMDB_LANGUAGE,
    sort_by: sortBy(kind, request.sort),
    with_genres: [animeOnly ? 16 : undefined, genre].filter((value) => value != null).join(',') || undefined,
    with_origin_country: request.country || (animeOnly && kind === 'tv' ? 'JP' : undefined),
    with_original_language: request.language || (animeOnly && kind === 'movie' ? 'ja' : undefined),
    ...(kind === 'movie'
      ? { primary_release_year: request.year }
      : { first_air_date_year: request.year }),
    'vote_average.gte': request.minScore ? request.minScore / 10 : undefined,
    'vote_count.gte': request.minVotes ?? (request.sort === 'rating' ? 100 : undefined),
    watch_region: request.watchProvider ? tmdbRegion() : undefined,
    with_watch_providers: request.watchProvider,
    with_watch_monetization_types: request.watchProvider ? 'flatrate|free|ads' : undefined,
  }
}

async function discover(kind: TmdbKind, request: CatalogSearchRequest, animeOnly = false): Promise<TmdbPage> {
  const genre = request.genre ? await genreId(kind, request.genre, request.signal) : undefined
  return tmdb<TmdbPage>(`/discover/${kind}`, tmdbDiscoverFilterParams(kind, request, genre, animeOnly), request.signal)
}

let genresPromise: Promise<{ movie: Map<string, number>; tv: Map<string, number> }> | null = null
async function genreMaps(signal?: AbortSignal) {
  if (!genresPromise) genresPromise = Promise.all([
    tmdb<{ genres?: { id?: number; name?: string }[] }>('/genre/movie/list', { language: TMDB_LANGUAGE }, signal),
    tmdb<{ genres?: { id?: number; name?: string }[] }>('/genre/tv/list', { language: TMDB_LANGUAGE }, signal),
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
      query, page: pageNumber, include_adult: get(showAdult), language: TMDB_LANGUAGE,
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
      results: sortTmdbItems([
        ...(movies.results ?? []).map((item) => ({ ...item, media_type: 'movie' as const })),
        ...(television.results ?? []).map((item) => ({ ...item, media_type: 'tv' as const })),
      ], request.sort),
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
    if (request.minScore && (item.vote_average ?? 0) * 10 < request.minScore) return false
    if (request.minVotes && (item.vote_count ?? 0) < request.minVotes) return false
    if (request.language && item.original_language !== request.language) return false
    if (request.country && !item.origin_country?.includes(request.country)) return false
    if (genre) {
      const wanted = maps?.[kind].get(genre)
      if (wanted != null && !item.genre_ids?.includes(wanted)) return false
    }
    if (animeOnly && (!item.genre_ids?.includes(16)
      || (!(item.origin_country?.includes('JP')) && item.original_language !== 'ja'))) return false
    return true
  })
  return sortTmdbItems(filtered, request.sort)
}

function sortTmdbItems(items: TmdbListItem[], sort?: CatalogSearchRequest['sort']): TmdbListItem[] {
  return items.sort((left, right) => {
    if (sort === 'rating') return (right.vote_average ?? 0) - (left.vote_average ?? 0)
    if (sort === 'recent') {
      const leftDate = left.release_date ?? left.first_air_date ?? ''
      const rightDate = right.release_date ?? right.first_air_date ?? ''
      return rightDate.localeCompare(leftDate)
    }
    if (sort === 'oldest') {
      const leftDate = left.release_date ?? left.first_air_date ?? '9999'
      const rightDate = right.release_date ?? right.first_air_date ?? '9999'
      return leftDate.localeCompare(rightDate)
    }
    if (sort === 'title') {
      const leftTitle = left.title ?? left.name ?? left.original_title ?? left.original_name ?? ''
      const rightTitle = right.title ?? right.name ?? right.original_title ?? right.original_name ?? ''
      return leftTitle.localeCompare(rightTitle)
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
    tmdb<TmdbSeasonDetail>(`/tv/${encodeURIComponent(id)}/season/${season.season_number}`, { language: TMDB_LANGUAGE }, signal)
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
  media.tagline = raw.tagline?.trim() || undefined
  media.episodes = kind === 'movie' ? 1 : raw.number_of_episodes
  media.duration = raw.runtime ?? raw.episode_run_time?.[0]
  media.genres = (raw.genres ?? []).flatMap((genre) => genre.name ? [genre.name] : [])
  media.tags = [...(raw.keywords?.keywords ?? raw.keywords?.results ?? [])]
    .flatMap((keyword) => keyword.name ? [{ name: keyword.name }] : [])
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
  media.logoImage = pickTmdbLogo(raw.images)
  const region = tmdbRegion()
  media.contentRating = tmdbContentRating(raw, region)
  media.watchRegion = region
  media.watchProviders = tmdbWatchProviders(raw['watch/providers'], region)
  return media
}

async function detail(ref: MediaRef, signal?: AbortSignal): Promise<Media | null> {
  if (ref.provider !== 'tmdb' || (ref.type !== 'movie' && ref.type !== 'series')) return null
  const kind: TmdbKind = ref.type === 'movie' ? 'movie' : 'tv'
  const append = kind === 'movie'
    ? 'videos,credits,recommendations,similar,external_ids,images,watch/providers,release_dates,keywords'
    : 'videos,aggregate_credits,recommendations,similar,external_ids,images,watch/providers,content_ratings,keywords'
  const raw = await tmdb<TmdbDetail>(`/${kind}/${encodeURIComponent(ref.id)}`, {
    language: TMDB_LANGUAGE, include_image_language: 'en,null', append_to_response: append,
  }, signal)
  const media = detailedMedia(raw, kind)
  if (!media) return null
  const [videos, externalRating] = await Promise.all([
    kind === 'movie'
      ? Promise.resolve([{ id: media.externalIds?.imdb ?? `tmdb:${ref.id}`, number: 1, title: media.title.userPreferred }])
      : televisionVideos(ref.id, raw.seasons ?? [], signal),
    media.externalIds?.imdb ? imdbRating(media.externalIds.imdb, kind, signal) : Promise.resolve(undefined),
  ])
  media.videos = videos
  if (externalRating) media.ratings = [externalRating, ...(media.ratings ?? [])]
  return enrichOmdbRatings(media, signal)
}

async function genres(signal?: AbortSignal): Promise<string[]> {
  const maps = await genreMaps(signal)
  return [...new Set([...maps.movie.keys(), ...maps.tv.keys()])]
    .map((name) => name.replace(/\b\w/g, (letter) => letter.toUpperCase())).sort()
}

let searchOptionsPromise: Promise<CatalogSearchOptions> | null = null
async function searchOptions(signal?: AbortSignal): Promise<CatalogSearchOptions> {
  if (!searchOptionsPromise) searchOptionsPromise = Promise.all([
    tmdb<TmdbLanguage[]>('/configuration/languages', {}, signal),
    tmdb<TmdbCountry[]>('/configuration/countries', {}, signal),
  ]).then(([languages, countries]) => ({
    languages: languages.flatMap((language) => language.iso_639_1 && language.english_name ? [{
      value: language.iso_639_1,
      label: language.name && language.name !== language.english_name
        ? `${language.english_name} · ${language.name}` : language.english_name,
    }] : []).sort((left, right) => left.label.localeCompare(right.label)),
    countries: countries.flatMap((country) => country.iso_3166_1 && country.english_name ? [{
      value: country.iso_3166_1,
      label: country.native_name && country.native_name !== country.english_name
        ? `${country.english_name} · ${country.native_name}` : country.english_name,
    }] : []).sort((left, right) => left.label.localeCompare(right.label)),
  })).catch((error) => { searchOptionsPromise = null; throw error })
  return searchOptionsPromise
}

export const tmdbCatalog: CatalogProvider = {
  id: 'tmdb',
  label: 'TMDB',
  capabilities: {
    anime: true, movies: true, series: true, search: true, genres: true,
    episodes: true, cast: true, relations: true,
  },
  homeRows: async () => TMDB_HOME_ROWS,
  home,
  search,
  detail,
  genres,
  searchOptions,
}
