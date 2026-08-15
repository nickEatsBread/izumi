import Bottleneck from 'bottleneck/light'
import { phttp } from '$lib/net/http'
import { getIndex, lookupAnilistByMal } from '$lib/stremio/idmap'
import type { FuzzyDate, Media } from './types'

const API = 'https://api.jikan.moe/v4'
const CATALOG_OPERATIONS = new Set([
  'Page', 'PageAll', 'Hero', 'HeroAll', 'Search', 'SearchAll', 'SearchCount', 'SearchCountAll',
  'GenreCollection',
])

export interface JikanCatalogRequest {
  operation: string
  query: string
  variables: Record<string, unknown>
}

interface JikanNamedResource { mal_id?: number; name?: string }
interface JikanMedia {
  mal_id?: number
  title?: string
  title_english?: string | null
  title_japanese?: string | null
  title_synonyms?: string[]
  titles?: { type?: string; title?: string }[]
  synopsis?: string | null
  type?: string | null
  source?: string | null
  episodes?: number | null
  status?: string | null
  duration?: string | null
  rating?: string | null
  score?: number | null
  members?: number | null
  season?: string | null
  year?: number | null
  aired?: { from?: string | null }
  images?: {
    webp?: { large_image_url?: string | null; image_url?: string | null; small_image_url?: string | null }
    jpg?: { large_image_url?: string | null; image_url?: string | null; small_image_url?: string | null }
  }
  trailer?: { youtube_id?: string | null }
  studios?: JikanNamedResource[]
  genres?: JikanNamedResource[]
  explicit_genres?: JikanNamedResource[]
  themes?: JikanNamedResource[]
  demographics?: JikanNamedResource[]
}

interface JikanPage {
  data?: JikanMedia[]
  pagination?: {
    has_next_page?: boolean
    current_page?: number
    items?: { total?: number }
  }
}

const limiter = new Bottleneck({
  reservoir: 60,
  reservoirRefreshAmount: 60,
  reservoirRefreshInterval: 60_000,
  maxConcurrent: 1,
  minTime: 350, // public Jikan limit: 3 requests/second
})

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function jikanJson<T>(url: string, attempt = 0): Promise<T> {
  // Only the HTTP attempt occupies the one-at-a-time limiter. Waiting/requeueing from inside the
  // scheduled callback would deadlock because the retry cannot start until that callback exits.
  const response = await limiter.schedule(() =>
    phttp(url, { timeoutMs: 15_000, maxBytes: 2 * 1024 * 1024 }))
  if ((response.status === 429 || response.status >= 500) && attempt < 2) {
    await sleep(1000 * 2 ** attempt)
    return jikanJson<T>(url, attempt + 1)
  }
  if (!response.ok) throw new Error(`Jikan returned HTTP ${response.status}`)
  return response.json() as Promise<T>
}

export function parseJikanCatalogRequest(body: BodyInit | null | undefined): JikanCatalogRequest | null {
  if (typeof body !== 'string') return null
  try {
    const parsed = JSON.parse(body) as { query?: unknown; variables?: unknown }
    if (typeof parsed.query !== 'string') return null
    const operation = /\bquery\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(parsed.query)?.[1]
    if (!operation || !CATALOG_OPERATIONS.has(operation)) return null
    const variables = parsed.variables && typeof parsed.variables === 'object'
      ? parsed.variables as Record<string, unknown>
      : {}
    return { operation, query: parsed.query, variables }
  } catch {
    return null
  }
}

const number = (value: unknown): number | undefined => {
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function fuzzyDate(iso: string | null | undefined): FuzzyDate | undefined {
  if (!iso) return undefined
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : undefined
}

function durationMinutes(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const hours = Number(/(\d+)\s*hr/.exec(value)?.[1] ?? 0)
  const minutes = Number(/(\d+)\s*min/.exec(value)?.[1] ?? 0)
  const total = hours * 60 + minutes
  return total || undefined
}

const FORMAT: Record<string, string> = {
  TV: 'TV', Movie: 'MOVIE', OVA: 'OVA', ONA: 'ONA', Special: 'SPECIAL',
  Music: 'MUSIC', CM: 'SPECIAL', PV: 'SPECIAL', 'TV Special': 'SPECIAL',
}
const STATUS: Record<string, string> = {
  'Currently Airing': 'RELEASING', 'Finished Airing': 'FINISHED', 'Not yet aired': 'NOT_YET_RELEASED',
}

/** Convert Jikan/MAL catalog metadata into the existing card model. `anilistId` comes from Fribb's
 *  cached MAL↔AniList map; a MAL id is never placed into Media.id because playback treats it as an
 *  AniList id everywhere downstream. */
export function mapJikanMedia(raw: JikanMedia, anilistId: number): Media {
  const preferred = raw.titles?.find((t) => t.type === 'Default')?.title ?? raw.title
  const webp = raw.images?.webp
  const jpg = raw.images?.jpg
  const genreNames = [...(raw.genres ?? []), ...(raw.explicit_genres ?? []), ...(raw.themes ?? []), ...(raw.demographics ?? [])]
    .map((item) => item.name)
    .filter((name): name is string => !!name)
  const adult = /rx\s*-\s*hentai/i.test(raw.rating ?? '') || genreNames.some((name) => /hentai/i.test(name))
  return {
    __typename: 'Media',
    id: anilistId,
    idMal: raw.mal_id ?? null,
    type: 'ANIME',
    title: {
      __typename: 'MediaTitle',
      romaji: preferred ?? null,
      english: raw.title_english ?? null,
      native: raw.title_japanese ?? null,
      userPreferred: raw.title_english || preferred || 'Unknown title',
    },
    description: raw.synopsis ?? null,
    season: raw.season?.toUpperCase() ?? null,
    seasonYear: raw.year ?? null,
    format: raw.type ? FORMAT[raw.type] ?? raw.type.toUpperCase().replaceAll(' ', '_') : null,
    status: raw.status ? STATUS[raw.status] ?? raw.status.toUpperCase().replaceAll(' ', '_') : null,
    episodes: raw.episodes ?? null,
    duration: durationMinutes(raw.duration) ?? null,
    source: raw.source?.toUpperCase().replaceAll(' ', '_') ?? null,
    averageScore: raw.score ? Math.round(raw.score * 10) : null,
    popularity: raw.members ?? null,
    trending: null,
    genres: genreNames,
    synonyms: raw.title_synonyms ?? [],
    startDate: fuzzyDate(raw.aired?.from) ?? null,
    studios: { __typename: 'StudioConnection', nodes: [] },
    coverImage: {
      __typename: 'MediaCoverImage',
      extraLarge: webp?.large_image_url ?? jpg?.large_image_url ?? null,
      large: webp?.large_image_url ?? jpg?.large_image_url ?? null,
      medium: webp?.image_url ?? jpg?.image_url ?? webp?.small_image_url ?? jpg?.small_image_url ?? null,
      color: null,
    },
    bannerImage: null,
    trailer: raw.trailer?.youtube_id
      ? { __typename: 'MediaTrailer', id: raw.trailer.youtube_id, site: 'youtube' }
      : null,
    nextAiringEpisode: null,
    airingSchedule: { __typename: 'AiringScheduleConnection', nodes: [] },
    isAdult: adult,
  // `Media` models nullable GraphQL fields as optional/undefined for app consumers; the wire
  // response must use explicit nulls so graphcache can distinguish "known absent" from omitted.
  } as unknown as Media
}

let genresPromise: Promise<Map<string, number>> | null = null
async function genreIds(): Promise<Map<string, number>> {
  if (!genresPromise) {
    genresPromise = jikanJson<{ data?: JikanNamedResource[] }>(`${API}/genres/anime`)
      .then((result) => new Map((result.data ?? []).flatMap((g) => g.name && g.mal_id != null ? [[g.name.toLowerCase(), g.mal_id]] : [])))
      .catch((error) => { genresPromise = null; throw error })
  }
  return genresPromise
}

function seasonRange(season: string | undefined, year: number | undefined): { start: string; end: string } | null {
  if (!year) return null
  const starts: Record<string, number> = { WINTER: 1, SPRING: 4, SUMMER: 7, FALL: 10 }
  const startMonth = season ? starts[season.toUpperCase()] : 1
  if (!startMonth) return null
  const endMonth = season ? startMonth + 2 : 12
  const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate()
  return {
    start: `${year}-${String(startMonth).padStart(2, '0')}-01`,
    end: `${year}-${String(endMonth).padStart(2, '0')}-${lastDay}`,
  }
}

async function catalogUrl(request: JikanCatalogRequest): Promise<string> {
  const v = request.variables
  const url = new URL(`${API}/anime`)
  const requested = Math.max(1, number(v.perPage) ?? 20)
  // Hero filters upcoming/music rows after the response, so ask for a little headroom.
  url.searchParams.set('limit', String(request.operation.startsWith('Hero') ? 25 : Math.min(requested, 25)))
  url.searchParams.set('page', String(Math.max(1, number(v.page) ?? 1)))
  if (typeof v.search === 'string' && v.search.trim()) url.searchParams.set('q', v.search.trim())
  if (/isAdult\s*:\s*false/.test(request.query)) url.searchParams.set('sfw', 'true')

  const names = [
    ...(typeof v.genre === 'string' ? [v.genre] : []),
    ...(Array.isArray(v.genre_in) ? v.genre_in.filter((name): name is string => typeof name === 'string') : []),
  ]
  if (names.length) {
    const ids = await genreIds()
    const found = names.map((name) => ids.get(name.toLowerCase())).filter((id): id is number => id != null)
    if (found.length) url.searchParams.set('genres', found.join(','))
  }

  const range = seasonRange(typeof v.season === 'string' ? v.season : undefined, number(v.seasonYear))
  if (range) {
    url.searchParams.set('start_date', range.start)
    url.searchParams.set('end_date', range.end)
  }
  const formats = Array.isArray(v.format_in) ? v.format_in : []
  const type = formats.length === 1 ? String(formats[0]).toLowerCase() : ''
  if (type && ['tv', 'movie', 'ova', 'ona', 'special', 'music'].includes(type)) url.searchParams.set('type', type)
  const statuses = Array.isArray(v.status_in) ? v.status_in : []
  const status = statuses.length === 1
    ? ({ FINISHED: 'complete', RELEASING: 'airing', NOT_YET_RELEASED: 'upcoming' } as Record<string, string>)[String(statuses[0])]
    : undefined
  if (status) url.searchParams.set('status', status)
  const score = number(v.averageScore_greater)
  if (score != null) url.searchParams.set('min_score', String((score + 1) / 10))

  const sort = Array.isArray(v.sort) ? String(v.sort[0] ?? '') : String(v.sort ?? '')
  if (sort === 'SCORE_DESC') { url.searchParams.set('order_by', 'score'); url.searchParams.set('sort', 'desc') }
  else if (sort === 'START_DATE_DESC') { url.searchParams.set('order_by', 'start_date'); url.searchParams.set('sort', 'desc') }
  else if (sort === 'POPULARITY_DESC' || sort === 'TRENDING_DESC') { url.searchParams.set('order_by', 'members'); url.searchParams.set('sort', 'desc') }
  // SEARCH_MATCH deliberately leaves Jikan's relevance ordering untouched.
  return url.toString()
}

export async function fetchJikanCatalog(request: JikanCatalogRequest): Promise<Response> {
  if (request.operation === 'GenreCollection') {
    const ids = await genreIds()
    return Response.json({ data: { GenreCollection: [...ids.keys()].map((name) => name.replace(/\b\w/g, (c) => c.toUpperCase())) } })
  }

  const result = await jikanJson<JikanPage>(await catalogUrl(request))
  const requested = Math.max(1, number(request.variables.perPage) ?? 20)
  let raw = result.data ?? []
  if (request.operation.startsWith('Hero')) {
    raw = raw.filter((media) => media.status !== 'Not yet aired' && media.type !== 'Music')
  }
  const index = await getIndex()
  const media = raw.flatMap((item) => {
    const malId = number(item.mal_id)
    const anilistId = malId == null ? undefined : lookupAnilistByMal(index, malId)
    return anilistId == null ? [] : [mapJikanMedia(item, anilistId)]
  }).slice(0, requested)
  const page = result.pagination
  return Response.json({
    data: {
      Page: {
        __typename: 'Page',
        pageInfo: {
          __typename: 'PageInfo',
          hasNextPage: !!page?.has_next_page,
          currentPage: page?.current_page ?? number(request.variables.page) ?? 1,
          total: page?.items?.total ?? null,
        },
        media,
      },
    },
  })
}

function graphQLError(text: string): string | null {
  try {
    const body = JSON.parse(text) as { errors?: { message?: string }[] }
    const messages = body.errors?.map((error) => error.message).filter((message): message is string => !!message) ?? []
    return messages.length ? messages.map((message) => `[GraphQL] ${message}`).join('\n') : null
  } catch {
    return null
  }
}

/** Return the user-facing reason only for availability failures that are safe to answer from Jikan.
 *  Ordinary GraphQL validation/authorization errors remain AniList errors and are not masked. */
export async function aniListCatalogFailure(response: Response): Promise<string | null> {
  const text = await response.clone().text()
  const gql = graphQLError(text)
  if (response.status === 429 || response.status >= 500) {
    return gql ?? `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
  }
  if (gql && /temporarily disabled|severe stability issues|service unavailable/i.test(gql)) return gql
  return null
}

export const aniListNetworkFailure = (error: unknown): string =>
  `[Network] ${error instanceof Error ? error.message : String(error)}`
