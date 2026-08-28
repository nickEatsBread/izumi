import { get } from 'svelte/store'
import { showAdult } from '$lib/settings/ui'
import { kitsuJson, mapKitsuMedia, type KitsuAnime } from '$lib/anilist/kitsu-catalog'
import type { ExternalMediaIds, Media, MediaVideo } from '$lib/anilist/types'
import { catalogHomeLayouts, resolveCatalogHomeRows } from '../home-layout'
import { KITSU_HOME_ROWS } from '../home-options'
import type { MediaRef } from '../identity'
import type { CatalogHome, CatalogHomeSection, CatalogPage, CatalogProvider, CatalogSearchRequest } from '../types'

const API = 'https://kitsu.io/api/edge'

interface IncludedResource {
  id?: string
  type?: string
  attributes?: Record<string, unknown> & {
    externalSite?: string
    externalId?: string
    title?: string
    nsfw?: boolean
    canonicalName?: string
    name?: string
    names?: { en?: string; ja_jp?: string }
    role?: string
    image?: { original?: string; large?: string; medium?: string }
    number?: number
    canonicalTitle?: string
    synopsis?: string
    thumbnail?: { original?: string; large?: string }
    airdate?: string
  }
  relationships?: {
    destination?: { data?: { id?: string; type?: string } }
    character?: { data?: { id?: string; type?: string } }
    person?: { data?: { id?: string; type?: string } }
  }
}

interface Page {
  data?: KitsuAnime[]
  included?: IncludedResource[]
  meta?: { count?: number }
  links?: { next?: string | null }
}

const number = (value: unknown): number | undefined => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function externalIds(page: Page): Map<number, ExternalMediaIds> {
  const included = new Map((page.included ?? []).flatMap((item) => item.id ? [[item.id, item]] : []))
  const result = new Map<number, ExternalMediaIds>()
  for (const anime of page.data ?? []) {
    const kitsu = number(anime.id)
    if (kitsu == null) continue
    const ids: ExternalMediaIds = { kitsu }
    for (const relation of anime.relationships?.mappings?.data ?? []) {
      const mapping = relation.id ? included.get(relation.id) : undefined
      const external = mapping?.attributes?.externalId
      if (!external) continue
      if (mapping.attributes?.externalSite === 'anilist/anime') ids.anilist = number(external)
      else if (mapping.attributes?.externalSite === 'myanimelist/anime') ids.mal = number(external)
      else if (mapping.attributes?.externalSite === 'themoviedb/series' || mapping.attributes?.externalSite === 'themoviedb/movie') ids.tmdb = number(external)
      else if (mapping.attributes?.externalSite === 'imdb') ids.imdb = String(external)
    }
    result.set(kitsu, ids)
  }
  return result
}

function mapPage(page: Page): Media[] {
  const ids = externalIds(page)
  return (page.data ?? []).flatMap((raw) => {
    const kitsu = number(raw.id)
    if (kitsu == null) return []
    const media = mapKitsuMedia(raw)
    media.externalIds = { ...media.externalIds, ...ids.get(kitsu) }
    media.idMal = media.externalIds?.mal
    return !get(showAdult) && media.isAdult ? [] : [media]
  })
}

async function animePage(
  params: Record<string, string | number | undefined>,
  signal?: AbortSignal,
): Promise<{ page: Page; media: Media[] }> {
  const url = new URL(`${API}/anime`)
  url.searchParams.set('include', 'mappings')
  url.searchParams.set('page[limit]', String(params.limit ?? 20))
  url.searchParams.set('page[offset]', String(params.offset ?? 0))
  for (const [key, value] of Object.entries(params)) {
    if (value == null || key === 'limit' || key === 'offset') continue
    url.searchParams.set(key, String(value))
  }
  const page = await kitsuJson<Page>(url.toString(), signal)
  return { page, media: mapPage(page) }
}

function currentSeason(date = new Date()): { season: string; year: number } {
  const month = date.getMonth() + 1
  return {
    season: month <= 3 ? 'winter' : month <= 6 ? 'spring' : month <= 9 ? 'summer' : 'fall',
    year: date.getFullYear(),
  }
}

async function home(signal?: AbortSignal, rowIds?: string[]): Promise<CatalogHome> {
  const now = currentSeason()
  const specs: Record<string, { params: Record<string, string | number | undefined>; more?: CatalogHomeSection['more'] }> = {
    season: { params: { 'filter[season]': now.season, 'filter[seasonYear]': now.year, sort: '-userCount', limit: 20 }, more: { sort: 'popular', year: now.year } },
    trending: { params: { 'filter[status]': 'current', sort: '-userCount', limit: 20 }, more: { sort: 'trending' } },
    popular: { params: { sort: '-userCount', limit: 20 }, more: { sort: 'popular' } },
    rated: { params: { sort: '-averageRating', limit: 20 }, more: { sort: 'rating' } },
    action: { params: { 'filter[categories]': 'action', sort: '-userCount', limit: 20 }, more: { genre: 'Action', sort: 'popular' } },
    romance: { params: { 'filter[categories]': 'romance', sort: '-userCount', limit: 20 }, more: { genre: 'Romance', sort: 'popular' } },
  }
  const configured = rowIds
    ? KITSU_HOME_ROWS.map((row) => ({ ...row, enabled: rowIds.includes(row.id) }))
    : resolveCatalogHomeRows('kitsu', KITSU_HOME_ROWS, get(catalogHomeLayouts))
  const selected = configured
    .filter((row) => row.enabled && row.id !== 'continue')
  // Airing Now also supplies the hero. Keep that request even when only its row is hidden.
  const fetchIds = selected.some((row) => row.id === 'trending')
    ? selected.map((row) => row.id)
    : ['trending', ...selected.map((row) => row.id)]
  const loaded = await Promise.all(fetchIds.flatMap((id) => specs[id] ? [animePage(specs[id].params, signal).then((page) => [id, page] as const)] : []))
  const mediaById = new Map(loaded.map(([id, page]) => [id, page.media]))
  const current = mediaById.get('trending') ?? []
  const heroPool = current.filter((media) => media.bannerImage || media.trailer?.id)
  return {
    hero: (heroPool.length ? heroPool : current).slice(0, 10),
    sections: selected.flatMap((row) => {
      const media = mediaById.get(row.id) ?? []
      return media.length ? [{ id: row.id, title: row.title, media, more: specs[row.id]?.more } satisfies CatalogHomeSection] : []
    }),
  }
}

async function search(request: CatalogSearchRequest): Promise<CatalogPage> {
  const pageNumber = Math.max(1, request.page ?? 1)
  const sort = request.sort === 'rating' ? '-averageRating'
    : request.sort === 'recent' ? '-startDate' : '-userCount'
  const result = await animePage({
    offset: (pageNumber - 1) * 20,
    limit: 20,
    sort,
    'filter[text]': request.query?.trim() || undefined,
    'filter[categories]': request.genre?.toLowerCase(),
    'filter[seasonYear]': request.year,
  }, request.signal)
  return {
    media: result.media,
    page: pageNumber,
    hasNextPage: !!result.page.links?.next,
    total: result.page.meta?.count,
  }
}

interface EpisodePage {
  data?: { id?: string; attributes?: IncludedResource['attributes'] }[]
  links?: { next?: string | null }
}

async function episodes(kitsuId: string, signal?: AbortSignal): Promise<MediaVideo[]> {
  const out: MediaVideo[] = []
  let url: string | null = `${API}/episodes?filter%5BmediaId%5D=${encodeURIComponent(kitsuId)}&sort=number&page%5Blimit%5D=20`
  // Hard cap prevents a malformed next-link cycle from turning a detail navigation into an
  // unbounded crawl. Long runners still expose their scalar episode count as number tiles.
  for (let page = 0; url && page < 25; page++) {
    const response: EpisodePage = await kitsuJson<EpisodePage>(url, signal)
    for (const item of response.data ?? []) {
      const attrs = item.attributes ?? {}
      const episode = number(attrs.number)
      if (episode == null) continue
      out.push({
        id: item.id,
        number: episode,
        episode,
        title: attrs.canonicalTitle,
        overview: attrs.synopsis,
        thumbnail: attrs.thumbnail?.original ?? attrs.thumbnail?.large,
        released: attrs.airdate,
      })
    }
    url = response.links?.next ?? null
  }
  return out.sort((a, b) => a.number - b.number)
}

interface CreditPage {
  data?: IncludedResource[]
  included?: IncludedResource[]
}

async function kitsuCredits(kitsuId: string, signal?: AbortSignal): Promise<Pick<Media, 'characters' | 'staff'>> {
  const [characters, staff] = await Promise.all([
    kitsuJson<CreditPage>(`${API}/anime/${encodeURIComponent(kitsuId)}/characters?include=character&page%5Blimit%5D=20`, signal).catch((): CreditPage => ({})),
    kitsuJson<CreditPage>(`${API}/anime/${encodeURIComponent(kitsuId)}/staff?include=person&page%5Blimit%5D=20`, signal).catch((): CreditPage => ({})),
  ])
  const characterById = new Map((characters.included ?? []).flatMap((item) => item.id ? [[item.id, item]] : []))
  const personById = new Map((staff.included ?? []).flatMap((item) => item.id ? [[item.id, item]] : []))
  return {
    characters: { edges: (characters.data ?? []).flatMap((credit) => {
      const id = credit.relationships?.character?.data?.id
      const character = id ? characterById.get(id) : undefined
      const name = character?.attributes?.canonicalName ?? character?.attributes?.name ?? character?.attributes?.names?.en
      return id && name ? [{
        role: credit.attributes?.role ?? 'Character',
        node: { id: number(id) ?? 0, name: { full: name }, image: { large: character?.attributes?.image?.large ?? character?.attributes?.image?.original } },
      }] : []
    }) },
    staff: { edges: (staff.data ?? []).flatMap((credit) => {
      const id = credit.relationships?.person?.data?.id
      const person = id ? personById.get(id) : undefined
      const name = person?.attributes?.name ?? person?.attributes?.canonicalName
      return id && name ? [{
        role: credit.attributes?.role ?? 'Staff',
        node: { id: number(id) ?? 0, name: { full: name }, image: { large: person?.attributes?.image?.large ?? person?.attributes?.image?.original } },
      }] : []
    }) },
  }
}

export function mapKitsuRelations(included: IncludedResource[]): NonNullable<Media['relations']> {
  const destinations = new Map(included.flatMap((item) =>
    item.type === 'anime' && item.id ? [[item.id, item]] : []))
  return { edges: included.flatMap((relation) => {
    if (relation.type !== 'mediaRelationships') return []
    const destinationId = relation.relationships?.destination?.data?.id
    const destination = destinationId ? destinations.get(destinationId) : undefined
    if (!destination?.id) return []
    const media = mapKitsuMedia({ id: destination.id, attributes: destination.attributes as KitsuAnime['attributes'] })
    return [{ relationType: relation.attributes?.role?.toUpperCase() ?? 'RELATED', node: media }]
  }) }
}

async function detail(ref: MediaRef, signal?: AbortSignal): Promise<Media | null> {
  if (ref.provider !== 'kitsu' || ref.type !== 'anime') return null
  const url = new URL(`${API}/anime/${encodeURIComponent(ref.id)}`)
  url.searchParams.set('include', 'mappings,categories,mediaRelationships.destination')
  const result = await kitsuJson<{ data?: KitsuAnime; included?: IncludedResource[] }>(url.toString(), signal)
  if (!result.data) return null
  const page: Page = { data: [result.data], included: result.included }
  const media = mapPage(page)[0]
  if (!media) return null

  const categories = new Map((result.included ?? []).flatMap((item) =>
    item.type === 'categories' && item.id && item.attributes?.title && !item.attributes.nsfw
      ? [[item.id, item.attributes.title] as const] : []))
  media.genres = result.data.relationships?.categories?.data
    ?.flatMap((item) => item.id && categories.has(item.id) ? [categories.get(item.id)!] : []) ?? []
  const [videos, credits] = await Promise.all([
    episodes(ref.id, signal).catch(() => []),
    kitsuCredits(ref.id, signal),
  ])
  media.videos = videos
  if (media.episodes && media.videos.length < media.episodes) {
    const known = new Set(media.videos.map((video) => video.number))
    media.videos.push(...Array.from({ length: media.episodes }, (_, index) => index + 1)
      .filter((episode) => !known.has(episode))
      .map((episode) => ({ number: episode, episode })))
    media.videos.sort((left, right) => left.number - right.number)
  }
  media.relations = mapKitsuRelations(result.included ?? [])
  media.characters = credits.characters
  media.staff = credits.staff
  return media
}

async function genres(signal?: AbortSignal): Promise<string[]> {
  const result = await kitsuJson<{ data?: IncludedResource[] }>(`${API}/categories?page%5Blimit%5D=100&sort=title`, signal)
  return (result.data ?? []).flatMap((item) => item.attributes?.title && !item.attributes.nsfw ? [item.attributes.title] : [])
}

export const kitsuCatalog: CatalogProvider = {
  id: 'kitsu',
  label: 'Kitsu',
  capabilities: {
    anime: true, movies: false, series: true, search: true, genres: true,
    episodes: true, cast: true, relations: true,
  },
  homeRows: async () => KITSU_HOME_ROWS,
  home,
  search,
  detail,
  genres,
}
