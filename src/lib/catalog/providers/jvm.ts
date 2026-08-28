import { get } from 'svelte/store'
import type { Media, MediaVideo } from '$lib/anilist/types'
import {
  browseJvmCatalogSource,
  detailJvmCatalogSource,
  installedJvmCatalogSources,
  type JvmCatalogSource,
} from '$lib/extensions/manager'
import { isJvmCatalogSourceEnabled, jvmCatalogSourceOverrides } from '$lib/settings/catalog'
import { catalogHomeLayouts, resolveCatalogHomeRows } from '../home-layout'
import { CONTINUE_HOME_ROW } from '../home-options'
import { compatibilityMediaId, mediaKey, type MediaRef } from '../identity'
import {
  CatalogConfigurationError,
  type CatalogHome,
  type CatalogHomeRowOption,
  type CatalogPage,
  type CatalogProvider,
  type CatalogSearchRequest,
} from '../types'

interface JvmIdentity {
  sourceId: string
  url: string
  title: string
  cover?: string
}

interface JvmHomeRequest {
  id: string
  source: JvmCatalogSource
  method: 'getPopular' | 'getLatestUpdates'
  title: string
}

const stringValue = (value: unknown): string | undefined => {
  const result = typeof value === 'string' ? value.trim() : ''
  return result || undefined
}

const imageOf = (raw: Record<string, unknown>): string | undefined =>
  stringValue(raw.cover) ?? stringValue(raw.thumbnail_url)

function genresOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => stringValue(item) ? [stringValue(item)!] : [])
  const text = stringValue(value)
  return text ? text.split(',').map((genre) => genre.trim()).filter(Boolean) : []
}

function statusOf(value: unknown): string | undefined {
  switch (Number(value)) {
    case 1: return 'RELEASING'
    case 2:
    case 4: return 'FINISHED'
    case 5: return 'CANCELLED'
    case 6: return 'HIATUS'
    case 7: return 'NOT_YET_RELEASED'
    default: return undefined
  }
}

function formatOf(value: unknown): string | undefined {
  const normalized = stringValue(value)?.toUpperCase().replace(/[\s-]+/g, '_')
  if (!normalized) return undefined
  const formats: Record<string, string> = {
    TV: 'TV', SERIES: 'TV', TV_SERIES: 'TV', TV_SHORT: 'TV_SHORT',
    MOVIE: 'MOVIE', FILM: 'MOVIE', SPECIAL: 'SPECIAL', OVA: 'OVA', ONA: 'ONA', MUSIC: 'MUSIC',
  }
  return formats[normalized]
}

function positiveNumber(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
}

function creatorsOf(raw: Record<string, unknown>): string[] {
  return [...new Set([stringValue(raw.author), stringValue(raw.artist)].filter((name): name is string => !!name))]
}

/** The media URL is part of Aniyomi's native identity and is required again by getDetail. Keeping
 * it in this opaque route id also makes history/deep links work after an app restart. */
export const encodeJvmIdentity = (identity: JvmIdentity): string => encodeURIComponent(JSON.stringify([
  identity.sourceId,
  identity.url,
  identity.title,
  identity.cover ?? '',
]))

export function decodeJvmIdentity(value: string): JvmIdentity | null {
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as unknown
    if (!Array.isArray(parsed) || parsed.length !== 4 || parsed.some((item) => typeof item !== 'string')) return null
    if (!parsed[0] || !parsed[1] || !parsed[2]) return null
    return { sourceId: parsed[0], url: parsed[1], title: parsed[2], cover: parsed[3] || undefined }
  } catch { return null }
}

export function mapJvmCatalogMedia(
  raw: Record<string, unknown>,
  source: Pick<JvmCatalogSource, 'id' | 'name' | 'icon' | 'lang'>,
  fallback?: Partial<JvmIdentity>,
): Media | null {
  const title = stringValue(raw.title) ?? fallback?.title
  const url = stringValue(raw.url) ?? fallback?.url
  if (!title || !url) return null
  const cover = imageOf(raw) ?? fallback?.cover
  const identity: JvmIdentity = { sourceId: source.id, url, title, cover }
  const ref = {
    provider: 'jvm' as const,
    type: 'anime' as const,
    id: encodeJvmIdentity(identity),
    sourceName: source.name,
    sourceIcon: source.icon,
    sourceLanguage: source.lang,
  }
  const description = stringValue(raw.description)
  const banner = stringValue(raw.background_url)
  const creators = creatorsOf(raw)
  return {
    id: compatibilityMediaId(ref),
    catalog: ref,
    type: 'ANIME',
    title: { romaji: title, english: title, userPreferred: title },
    description,
    creators: creators.length ? creators : undefined,
    seasonNumber: positiveNumber(raw.season_number),
    // Aniyomi's SAnime contract does not define a TV/movie format. Only retain a format when an
    // individual source explicitly supplies one instead of labelling every JVM result as TV.
    format: formatOf(raw.format ?? raw.media_type),
    status: statusOf(raw.status),
    genres: genresOf(raw.genre),
    coverImage: { extraLarge: cover, large: cover, medium: cover },
    bannerImage: banner,
  }
}

function episodeNumber(raw: Record<string, unknown>): number {
  const direct = Number(raw.episode_number)
  if (Number.isFinite(direct) && direct >= 0) return direct
  const name = String(raw.name ?? '')
  const parsed = name.match(/(?:episode|ep\.?|e)\s*(\d+(?:\.\d+)?)/i)?.[1]
    ?? name.match(/(\d+(?:\.\d+)?)/)?.[1]
  return Number.parseFloat(parsed ?? '')
}

function videosOf(value: unknown): MediaVideo[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const raw = item as Record<string, unknown>
    const number = episodeNumber(raw)
    if (!Number.isFinite(number)) return []
    const name = stringValue(raw.name)
    const url = stringValue(raw.url)
    return [{
      id: url ? JSON.stringify({ url, name: name ?? '' }) : undefined,
      number,
      episode: number,
      season: Number.isFinite(Number(raw.season)) ? Number(raw.season) : undefined,
      title: name,
    }]
  }).sort((left, right) => left.number - right.number)
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

async function selectedSources(): Promise<JvmCatalogSource[]> {
  const installed = await installedJvmCatalogSources()
  if (!installed.length) {
    throw new CatalogConfigurationError('Install and enable an Aniyomi/JVM anime source in Settings → Sources first.')
  }
  const overrides = get(jvmCatalogSourceOverrides)
  const selected = installed.filter((source) => isJvmCatalogSourceEnabled(source.id, overrides))
  if (!selected.length) {
    throw new CatalogConfigurationError('Choose at least one JVM catalog source in Settings → Catalog.')
  }
  return selected
}

async function sourcePage(
  source: JvmCatalogSource,
  method: 'getPopular' | 'getLatestUpdates' | 'search',
  page: number,
  signal?: AbortSignal,
  query = '',
): Promise<{ media: Media[]; hasNextPage: boolean }> {
  throwIfAborted(signal)
  const result = await browseJvmCatalogSource(source.id, method, page, query)
  throwIfAborted(signal)
  return {
    media: result.list.flatMap((raw) => {
      const media = mapJvmCatalogMedia(raw, source)
      return media ? [media] : []
    }),
    hasNextPage: result.hasNextPage,
  }
}

function jvmHomeRequests(sources: JvmCatalogSource[]): JvmHomeRequest[] {
  return sources.flatMap((source) => {
    const calls: JvmHomeRequest[] = []
    if (source.supportsPopular) calls.push({
      id: `popular:${source.id}`, source, method: 'getPopular', title: `Popular · ${source.name}`,
    })
    if (source.supportsLatest) calls.push({
      id: `latest:${source.id}`, source, method: 'getLatestUpdates', title: `Latest updates · ${source.name}`,
    })
    if (!calls.length) calls.push({
      id: `popular:${source.id}`, source, method: 'getPopular', title: `Popular · ${source.name}`,
    })
    return calls
  })
}

function jvmHomeOptions(requests: JvmHomeRequest[]): CatalogHomeRowOption[] {
  return [CONTINUE_HOME_ROW, ...requests.map((request) => ({
    id: request.id,
    title: request.title,
    description: `${request.method === 'getPopular' ? 'Popular anime' : 'Recently updated anime'} from ${request.source.name}.`,
    group: request.source.name,
    defaultEnabled: true,
  }))]
}

async function homeRows(): Promise<CatalogHomeRowOption[]> {
  return jvmHomeOptions(jvmHomeRequests(await selectedSources()))
}

async function home(signal?: AbortSignal, rowIds?: string[]): Promise<CatalogHome> {
  const sources = await selectedSources()
  const available = jvmHomeRequests(sources)
  const byId = new Map(available.map((request) => [request.id, request]))
  const options = jvmHomeOptions(available)
  const configured = rowIds
    ? options.map((row) => ({ ...row, enabled: rowIds.includes(row.id) }))
    : resolveCatalogHomeRows('jvm', options, get(catalogHomeLayouts))
  const selected = configured
    .filter((row) => row.enabled && row.id !== 'continue')
    .flatMap((row) => byId.get(row.id) ?? [])
  // Keep one selected source available to the featured banner even when all of its rows are hidden.
  const requests = available[0] && !selected.some((request) => request.id === available[0].id)
    ? [available[0], ...selected]
    : selected
  const results = await Promise.allSettled(requests.map(async (request) => ({
    request,
    page: await sourcePage(request.source, request.method, 1, signal),
  })))
  throwIfAborted(signal)
  const loaded = new Map(results.flatMap((result) => result.status === 'fulfilled'
    ? [[result.value.request.id, result.value.page.media] as const]
    : []))
  const sections = selected.flatMap((request) => {
    const media = loaded.get(request.id) ?? []
    return media.length ? [{ id: request.id, title: request.title, media }] : []
  })
  if (!sections.length && results.every((result) => result.status === 'rejected')) {
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    throw failure?.reason ?? new Error('The selected JVM sources did not return catalog data.')
  }
  const all = [...loaded.values()].flat()
  const unique = [...new Map(all.map((media) => [mediaKey(media), media])).values()]
  const withBanners = unique.filter((media) => media.bannerImage)
  return { hero: (withBanners.length ? withBanners : unique).slice(0, 10), sections }
}

async function search(request: CatalogSearchRequest): Promise<CatalogPage> {
  const sources = await selectedSources()
  const page = Math.max(1, request.page ?? 1)
  const query = request.query?.trim() ?? ''
  const results = await Promise.allSettled(sources.map((source) => {
    const method = query
      ? 'search' as const
      : (request.sort === 'recent' || request.sort === 'trending') && source.supportsLatest
        ? 'getLatestUpdates' as const
        : 'getPopular' as const
    return sourcePage(source, method, page, request.signal, query)
  }))
  throwIfAborted(request.signal)
  if (results.every((result) => result.status === 'rejected')) {
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    throw failure?.reason ?? new Error('The selected JVM sources did not return search results.')
  }
  // Multiple sources usually return the same show. Keep the first selected source's version so
  // search remains useful instead of filling the grid with visually identical cards.
  const unique = new Map<string, Media>()
  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    for (const media of result.value.media) {
      const key = (media.title.romaji ?? media.title.english ?? '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
      if (!unique.has(key || mediaKey(media))) unique.set(key || mediaKey(media), media)
    }
  }
  return {
    media: [...unique.values()],
    page,
    hasNextPage: results.some((result) => result.status === 'fulfilled' && result.value.hasNextPage),
  }
}

async function detail(ref: MediaRef, signal?: AbortSignal): Promise<Media | null> {
  if (ref.provider !== 'jvm' || ref.type !== 'anime') return null
  const identity = decodeJvmIdentity(ref.id)
  if (!identity) return null
  const source = (await installedJvmCatalogSources()).find((entry) => entry.id === identity.sourceId)
  if (!source) throw new CatalogConfigurationError('The JVM source that supplied this title is no longer installed or enabled.')
  throwIfAborted(signal)
  const raw = await detailJvmCatalogSource(source.id, {
    url: identity.url,
    title: identity.title,
    thumbnail_url: identity.cover ?? '',
  })
  throwIfAborted(signal)
  const media = mapJvmCatalogMedia(raw, source, identity)
  if (!media) return null
  media.videos = videosOf(raw.episodes)
  media.episodes = media.videos.length || undefined
  return media
}

export const jvmCatalog: CatalogProvider = {
  id: 'jvm',
  label: 'JVM sources',
  capabilities: {
    anime: true, movies: false, series: true, search: true,
    episodes: true, cast: false, relations: false,
  },
  homeRows,
  home,
  search,
  detail,
}
