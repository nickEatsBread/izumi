import { phttp } from '$lib/net/http'
import { getIndex, lookupAnilistByKitsu } from '$lib/stremio/idmap'
import type { Media } from './types'
import type { JikanCatalogRequest } from './jikan'
import { compatibilityMediaId } from '$lib/catalog/identity'

const API = 'https://kitsu.io/api/edge'

interface KitsuImage { tiny?: string; small?: string; medium?: string; large?: string; original?: string }
export interface KitsuAnime {
  id?: string
  relationships?: {
    mappings?: { data?: { id?: string; type?: string }[] }
    categories?: { data?: { id?: string; type?: string }[] }
  }
  attributes?: {
    synopsis?: string | null
    titles?: { en?: string; en_jp?: string; ja_jp?: string }
    canonicalTitle?: string
    slug?: string
    abbreviatedTitles?: string[]
    posterImage?: KitsuImage | null
    coverImage?: KitsuImage | null
    startDate?: string | null
    season?: string | null
    seasonYear?: number | null
    subtype?: string | null
    status?: string | null
    episodeCount?: number | null
    episodeLength?: number | null
    averageRating?: string | null
    userCount?: number | null
    youtubeVideoId?: string | null
    ageRating?: string | null
  }
}
interface KitsuPage {
  data?: KitsuAnime[]
  included?: KitsuIncluded[]
  meta?: { count?: number }
  links?: { next?: string | null }
}
interface KitsuIncluded {
  id?: string
  type?: string
  attributes?: { externalSite?: string; externalId?: string; title?: string; nsfw?: boolean }
}
interface KitsuMappingPage {
  data?: { relationships?: { item?: { data?: { id?: string; type?: string } } } }[]
}
interface KitsuDetailPage { data?: KitsuAnime; included?: KitsuIncluded[] }

export interface KitsuDetailRequest {
  operation: 'MediaById'
  variables: { id: number }
}

/** Only the read-only anime detail screen is eligible. Account/list queries and manga details must
 * keep their AniList error because Kitsu cannot safely emulate viewer-owned state. */
export function parseKitsuDetailRequest(body: BodyInit | null | undefined): KitsuDetailRequest | null {
  if (typeof body !== 'string') return null
  try {
    const parsed = JSON.parse(body) as { query?: unknown; variables?: { id?: unknown } }
    if (typeof parsed.query !== 'string' || !/\bquery\s+MediaById\b/.test(parsed.query)) return null
    const id = n(parsed.variables?.id)
    return id != null ? { operation: 'MediaById', variables: { id } } : null
  } catch { return null }
}

function directAniListIds(page: KitsuPage): Map<number, number> {
  const included = new Map((page.included ?? []).flatMap((mapping) => {
    const id = mapping.id
    const anilistId = n(mapping.attributes?.externalId)
    return id && mapping.type === 'mappings'
      && mapping.attributes?.externalSite === 'anilist/anime' && anilistId != null
      ? [[id, anilistId] as const] : []
  }))
  const out = new Map<number, number>()
  for (const anime of page.data ?? []) {
    const kitsuId = n(anime.id)
    const anilistId = anime.relationships?.mappings?.data
      ?.map((mapping) => mapping.id ? included.get(mapping.id) : undefined)
      .find((id): id is number => id != null)
    if (kitsuId != null && anilistId != null) out.set(kitsuId, anilistId)
  }
  return out
}

const n = (value: unknown): number | undefined => {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

const FORMAT: Record<string, string> = {
  TV: 'TV', movie: 'MOVIE', OVA: 'OVA', ONA: 'ONA', special: 'SPECIAL', music: 'MUSIC',
}
const STATUS: Record<string, string> = {
  current: 'RELEASING', finished: 'FINISHED', upcoming: 'NOT_YET_RELEASED', tba: 'NOT_YET_RELEASED',
  unreleased: 'NOT_YET_RELEASED',
}

export function mapKitsuMedia(raw: KitsuAnime, anilistId?: number): Media {
  const a = raw.attributes ?? {}
  const title = a.titles ?? {}
  const score = n(a.averageRating)
  const start = /^([0-9]{4})-([0-9]{2})-([0-9]{2})/.exec(a.startDate ?? '')
  const subtype = a.subtype ?? ''
  const kitsuId = n(raw.id)
  const ref = { provider: 'kitsu' as const, type: 'anime' as const, id: String(raw.id ?? '') }
  return {
    __typename: 'Media', id: anilistId ?? compatibilityMediaId(ref), idMal: null, type: 'ANIME',
    catalog: ref,
    externalIds: { kitsu: kitsuId, anilist: anilistId },
    title: {
      __typename: 'MediaTitle',
      romaji: title.en_jp ?? a.canonicalTitle ?? null,
      english: title.en ?? null,
      native: title.ja_jp ?? null,
      userPreferred: title.en ?? a.canonicalTitle ?? title.en_jp ?? 'Unknown title',
    },
    description: a.synopsis ?? null,
    season: a.season?.toUpperCase() ?? null,
    seasonYear: a.seasonYear ?? (start ? Number(start[1]) : null),
    format: FORMAT[subtype] ?? FORMAT[subtype.toUpperCase()] ?? (subtype.toUpperCase() || null),
    status: STATUS[a.status ?? ''] ?? a.status?.toUpperCase() ?? null,
    episodes: a.episodeCount ?? null,
    duration: a.episodeLength ?? null,
    averageScore: score == null ? null : Math.round(score),
    ratings: score == null ? undefined : [{ source: 'Kitsu', score, scale: 100 }],
    popularity: a.userCount ?? null,
    trending: null,
    genres: [],
    // Kitsu's anime resource does not expose AniList's source-material/country fields. Explicit
    // null/empty values are required on the GraphQL wire shape so graphcache can hydrate the richer
    // detail query during an AniList outage instead of rejecting the entire fallback record.
    source: null,
    countryOfOrigin: null,
    tags: [],
    synonyms: a.abbreviatedTitles ?? [],
    startDate: start
      ? { __typename: 'FuzzyDate', year: Number(start[1]), month: Number(start[2]), day: Number(start[3]) }
      : null,
    studios: { __typename: 'StudioConnection', nodes: [] },
    coverImage: {
      __typename: 'MediaCoverImage',
      extraLarge: a.posterImage?.original ?? a.posterImage?.large ?? null,
      large: a.posterImage?.large ?? a.posterImage?.medium ?? null,
      medium: a.posterImage?.medium ?? a.posterImage?.small ?? null,
      color: null,
    },
    bannerImage: a.coverImage?.original ?? a.coverImage?.large ?? null,
    trailer: a.youtubeVideoId
      ? { __typename: 'MediaTrailer', id: a.youtubeVideoId, site: 'youtube' }
      : null,
    nextAiringEpisode: null,
    airingSchedule: { __typename: 'AiringScheduleConnection', nodes: [] },
    isAdult: /^(R18|18)$/i.test(a.ageRating ?? ''),
  // `Media` models nullable GraphQL fields as optional/undefined for app consumers; the wire
  // response must use explicit nulls so graphcache can distinguish "known absent" from omitted.
  } as unknown as Media
}

function animeUrl(request: JikanCatalogRequest): string {
  const v = request.variables
  const requested = Math.min(20, Math.max(1, n(v.perPage) ?? 20))
  const page = Math.max(1, n(v.page) ?? 1)
  const url = new URL(`${API}/anime`)
  url.searchParams.set('page[limit]', String(requested))
  url.searchParams.set('page[offset]', String((page - 1) * requested))
  url.searchParams.set('include', 'mappings')
  if (typeof v.search === 'string' && v.search.trim()) url.searchParams.set('filter[text]', v.search.trim())
  const genres = [
    ...(typeof v.genre === 'string' ? [v.genre] : []),
    ...(Array.isArray(v.genre_in) ? v.genre_in.filter((g): g is string => typeof g === 'string') : []),
  ]
  if (genres.length) url.searchParams.set('filter[categories]', genres.map((g) => g.toLowerCase()).join(','))
  if (typeof v.season === 'string') url.searchParams.set('filter[season]', v.season.toLowerCase())
  if (n(v.seasonYear) != null) url.searchParams.set('filter[seasonYear]', String(n(v.seasonYear)))
  const formats = Array.isArray(v.format_in) ? v.format_in : []
  if (formats.length === 1) url.searchParams.set('filter[subtype]', String(formats[0]).toLowerCase())
  const statuses = Array.isArray(v.status_in) ? v.status_in : []
  const status = statuses.length === 1
    ? ({ FINISHED: 'finished', RELEASING: 'current', NOT_YET_RELEASED: 'upcoming' } as Record<string, string>)[String(statuses[0])]
    : undefined
  if (status) url.searchParams.set('filter[status]', status)
  const sort = Array.isArray(v.sort) ? String(v.sort[0] ?? '') : String(v.sort ?? '')
  if (sort === 'SCORE_DESC') url.searchParams.set('sort', '-averageRating')
  else if (sort === 'START_DATE_DESC') url.searchParams.set('sort', '-startDate')
  else if (sort === 'POPULARITY_DESC' || sort === 'TRENDING_DESC') url.searchParams.set('sort', '-userCount')
  return url.toString()
}

export async function kitsuJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await phttp(url, { signal, timeoutMs: 15_000, maxBytes: 2 * 1024 * 1024 })
  if (!response.ok) throw new Error(`Kitsu returned HTTP ${response.status}`)
  return response.json() as Promise<T>
}

const titleKey = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '')

/** Metadata index for AnimeSchedule's weekly HTML. The timetable deliberately carries no external
 * ids; Kitsu supplies those without depending on AniList or MyAnimeList, and Fribb keeps the ids
 * canonical for app navigation/playback. */
export async function fetchKitsuScheduleIndex(
  year: number, season: string, includeSeason = true,
): Promise<Map<string, Media>> {
  const entries: KitsuAnime[] = []
  const direct = new Map<number, number>()
  const append = (page: KitsuPage | null) => {
    if (!page) return
    entries.push(...(page.data ?? []))
    for (const [kitsuId, anilistId] of directAniListIds(page)) direct.set(kitsuId, anilistId)
  }
  // Schedule is already in a degraded path. Keep every successful page if a later page is
  // throttled instead of turning useful partial metadata into a total failure.
  const safePage = (url: string) => kitsuJson<KitsuPage>(url).catch(() => null)
  if (includeSeason) {
    const seasonal = new URL(`${API}/anime`)
    seasonal.searchParams.set('filter[season]', season.toLowerCase())
    seasonal.searchParams.set('filter[seasonYear]', String(year))
    seasonal.searchParams.set('sort', '-userCount')
    seasonal.searchParams.set('page[limit]', '20')
    seasonal.searchParams.set('include', 'mappings')
    const first = await safePage(seasonal.toString())
    const pages = Math.min(6, Math.max(1, Math.ceil((first?.meta?.count ?? first?.data?.length ?? 0) / 20)))
    append(first)
    for (let page = 1; page < pages; page++) {
      seasonal.searchParams.set('page[offset]', String(page * 20))
      const next = await safePage(seasonal.toString())
      if (!next) break
      append(next)
    }
  }
  // Long-running shows began in an older season. Two popularity pages cover the useful tail while
  // keeping degraded Schedule well below Kitsu's normal catalogue request volume.
  for (const offset of [0, 20]) {
    const current = new URL(`${API}/anime`)
    current.searchParams.set('filter[status]', 'current')
    current.searchParams.set('sort', '-userCount')
    current.searchParams.set('page[limit]', '20')
    current.searchParams.set('page[offset]', String(offset))
    current.searchParams.set('include', 'mappings')
    const next = await safePage(current.toString())
    append(next)
  }

  if (!entries.length) return new Map()
  const needsFallback = entries.some((raw) => {
    const kitsuId = n(raw.id)
    return kitsuId != null && !direct.has(kitsuId)
  })
  const idMap = needsFallback ? await getIndex() : new Map()
  const out = new Map<string, Media>()
  for (const raw of entries) {
    const kitsuId = n(raw.id)
    const anilistId = kitsuId == null ? undefined
      : direct.get(kitsuId) ?? lookupAnilistByKitsu(idMap, kitsuId)
    if (anilistId == null) continue
    const media = mapKitsuMedia(raw, anilistId)
    const a = raw.attributes ?? {}
    const keys = [a.slug, a.canonicalTitle, a.titles?.en, a.titles?.en_jp, a.titles?.ja_jp, ...(a.abbreviatedTitles ?? [])]
    for (const key of keys) if (key) {
      out.set(key.toLowerCase(), media)
      const normalized = titleKey(key)
      if (normalized && !out.has(normalized)) out.set(normalized, media)
    }
  }
  return out
}

export async function fetchKitsuCatalog(request: JikanCatalogRequest): Promise<Response> {
  if (request.operation === 'GenreCollection') {
    const result = await kitsuJson<{ data?: { attributes?: { title?: string } }[] }>(`${API}/categories?page%5Blimit%5D=100&sort=title`)
    const genres = (result.data ?? []).flatMap((item) => item.attributes?.title ? [item.attributes.title] : [])
    return Response.json({ data: { GenreCollection: genres } })
  }
  const result = await kitsuJson<KitsuPage>(animeUrl(request))
  const direct = directAniListIds(result)
  const needsFallback = (result.data ?? []).some((item) => {
    const kitsuId = n(item.id)
    return kitsuId != null && !direct.has(kitsuId)
  })
  const index = needsFallback ? await getIndex() : new Map()
  let raw = result.data ?? []
  if (request.operation.startsWith('Hero')) {
    raw = raw.filter((item) => item.attributes?.status !== 'upcoming' && item.attributes?.subtype !== 'music')
  }
  const media = raw.flatMap((item) => {
    const kitsuId = n(item.id)
    const anilistId = kitsuId == null ? undefined
      : direct.get(kitsuId) ?? lookupAnilistByKitsu(index, kitsuId)
    return anilistId == null ? [] : [mapKitsuMedia(item, anilistId)]
  })
  // A non-empty Kitsu page must never masquerade as a successful empty GraphQL page. That used to
  // produce bare Home headings and Browse's misleading "No results" when an id-map response was
  // stale. `include=mappings` supplies canonical AniList ids inline; if Kitsu ever omits them and
  // the compatibility index cannot fill any, let the caller try Jikan or surface the real outage.
  if (raw.length && !media.length) throw new Error('Kitsu returned catalog entries without AniList mappings')
  const page = Math.max(1, n(request.variables.page) ?? 1)
  return Response.json({ data: { Page: {
    __typename: 'Page',
    pageInfo: {
      __typename: 'PageInfo', hasNextPage: !!result.links?.next, currentPage: page,
      total: result.meta?.count ?? null,
    },
    media,
  } } })
}

/** Resolve an AniList id through Kitsu's mapping resource, then return the full anime record in the
 * exact GraphQL shape consumed by AnimeDetail. Unsupported rich tabs are honest empty collections;
 * playback still receives canonical AniList/MAL ids and the complete episode/card metadata. */
export async function fetchKitsuDetail(request: KitsuDetailRequest): Promise<Response> {
  const mappingUrl = new URL(`${API}/mappings`)
  mappingUrl.searchParams.set('filter[externalSite]', 'anilist/anime')
  mappingUrl.searchParams.set('filter[externalId]', String(request.variables.id))
  // Kitsu only materializes the polymorphic `item.data` relationship when it is included.
  mappingUrl.searchParams.set('include', 'item')
  const mapping = await kitsuJson<KitsuMappingPage>(mappingUrl.toString())
  const kitsuId = mapping.data?.find((item) => item.relationships?.item?.data?.type === 'anime')
    ?.relationships?.item?.data?.id
  if (!kitsuId) return Response.json({ data: { Media: null } })

  const detailUrl = new URL(`${API}/anime/${encodeURIComponent(kitsuId)}`)
  detailUrl.searchParams.set('include', 'mappings,categories')
  const detail = await kitsuJson<KitsuDetailPage>(detailUrl.toString())
  if (!detail.data) return Response.json({ data: { Media: null } })

  const included = detail.included ?? []
  const malId = included.find((item) => item.type === 'mappings'
    && item.attributes?.externalSite === 'myanimelist/anime')?.attributes?.externalId
  const categories = new Map(included.flatMap((item) =>
    item.type === 'categories' && item.id && item.attributes?.title && !item.attributes.nsfw
      ? [[item.id, item.attributes.title] as const] : []))
  const genres = detail.data.relationships?.categories?.data
    ?.flatMap((item) => item.id && categories.has(item.id) ? [categories.get(item.id)!] : []) ?? []

  const media = mapKitsuMedia(detail.data, request.variables.id) as unknown as Record<string, unknown>
  media.idMal = n(malId) ?? null
  media.genres = genres
  media.isFavourite = null
  media.mediaListEntry = null
  media.relations = { __typename: 'MediaRelationConnection', edges: [] }
  media.characters = { __typename: 'CharacterConnection', edges: [] }
  media.staff = { __typename: 'StaffConnection', edges: [] }
  media.recommendations = { __typename: 'RecommendationConnection', nodes: [] }
  return Response.json({ data: { Media: media } })
}
