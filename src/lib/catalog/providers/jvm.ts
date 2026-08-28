import { get } from 'svelte/store'
import type { Media, MediaVideo } from '$lib/anilist/types'
import {
  browseJvmCatalogSource,
  detailJvmCatalogSource,
  installedJvmCatalogSources,
  type JvmCatalogSource,
  type JvmSourceFilter,
} from '$lib/extensions/manager'
import { isJvmCatalogSourceEnabled, jvmCatalogSourceOverrides } from '$lib/settings/catalog'
import { catalogHomeLayouts, resolveCatalogHomeRows } from '../home-layout'
import { CONTINUE_HOME_ROW } from '../home-options'
import { compatibilityMediaId, mediaKey, type MediaRef } from '../identity'
import {
  CatalogConfigurationError,
  type CatalogHome,
  type CatalogHomeUpdate,
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

// The manager also protects the native bridge globally, but Home remains serial itself so it never
// creates a large queue that can sit in front of a detail/search request after the user navigates.
const JVM_HOME_CONCURRENCY = 1
const JVM_HOME_ROW_TIMEOUT_MS = 5_000
const JVM_HOME_LOAD_BUDGET_MS = 12_000

function waitForSignal<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      cleanup()
      reject(new DOMException('Aborted', 'AbortError'))
    }
    const cleanup = () => signal.removeEventListener('abort', abort)
    if (signal.aborted) {
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once: true })
    work.then(
      (value) => { cleanup(); resolve(value) },
      (error) => { cleanup(); reject(error) },
    )
  })
}

async function settleWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  load: (value: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(values.length)
  let cursor = 0
  const worker = async () => {
    while (cursor < values.length) {
      const index = cursor++
      try {
        results[index] = { status: 'fulfilled', value: await load(values[index]) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(Math.max(1, concurrency), values.length) },
    () => worker(),
  ))
  return results
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
    fetchType: stringValue(raw.fetch_type),
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
    const uploaded = Number(raw.date_upload)
    return [{
      id: url ? JSON.stringify({ url, name: name ?? '' }) : undefined,
      number,
      episode: number,
      season: Number.isFinite(Number(raw.season)) ? Number(raw.season) : undefined,
      title: name,
      ...(stringValue(raw.summary) ? { overview: stringValue(raw.summary) } : {}),
      ...(stringValue(raw.preview_url) ? { thumbnail: stringValue(raw.preview_url) } : {}),
      ...(Number.isFinite(uploaded) && uploaded > 0 ? {
        released: new Date(uploaded < 1_000_000_000_000 ? uploaded * 1000 : uploaded).toISOString(),
      } : {}),
      ...(raw.fillermark === true ? { filler: true } : {}),
      ...(stringValue(raw.scanlator) ? { group: stringValue(raw.scanlator) } : {}),
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
    throw new CatalogConfigurationError('Choose at least one Aniyomi source in Settings → Catalog.')
  }
  return selected
}

async function sourcePage(
  source: JvmCatalogSource,
  method: 'getPopular' | 'getLatestUpdates' | 'search',
  page: number,
  signal?: AbortSignal,
  query = '',
  filters?: JvmSourceFilter[],
): Promise<{ media: Media[]; hasNextPage: boolean }> {
  throwIfAborted(signal)
  const result = filters || signal
    ? await browseJvmCatalogSource(source.id, method, page, query, filters, signal)
    : await browseJvmCatalogSource(source.id, method, page, query)
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
  // Visit each source once before asking any source for its second row. A broken first extension
  // can then only cost one bounded timeout before another provider gets a chance to paint Home.
  const popular = sources.flatMap((source) => source.supportsPopular ? [{
      id: `popular:${source.id}`, source, method: 'getPopular', title: `Popular · ${source.name}`,
    } satisfies JvmHomeRequest] : [])
  const latest = sources.flatMap((source) => source.supportsLatest ? [{
      id: `latest:${source.id}`, source, method: 'getLatestUpdates', title: `Latest updates · ${source.name}`,
    } satisfies JvmHomeRequest] : [])
  return [...popular, ...latest]
}

async function homeSourcePage(request: JvmHomeRequest, signal?: AbortSignal) {
  const controller = new AbortController()
  let timedOut = false
  const abort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, JVM_HOME_ROW_TIMEOUT_MS)
  try {
    return await sourcePage(request.source, request.method, 1, controller.signal)
  } catch (error) {
    if (timedOut && !signal?.aborted) {
      throw new Error(`${request.source.name} took too long to load ${request.title.toLowerCase()}.`)
    }
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

async function enrichHero(media: Media[], signal?: AbortSignal): Promise<Media[]> {
  const candidates = media.filter((item) => !item.bannerImage).slice(0, 3)
  if (!candidates.length) return media
  const details = await Promise.allSettled(candidates.map(async (item) => {
    const identity = item.catalog ? decodeJvmIdentity(item.catalog.id) : null
    if (!identity) return null
    const request = {
      url: identity.url,
      title: identity.title,
      thumbnail_url: identity.cover ?? '',
    }
    const raw = signal
      ? await detailJvmCatalogSource(identity.sourceId, request, signal)
      : await detailJvmCatalogSource(identity.sourceId, request)
    const mapped = mapJvmCatalogMedia(raw, {
      id: identity.sourceId,
      name: item.catalog?.sourceName ?? '',
      icon: item.catalog?.sourceIcon,
      lang: item.catalog?.sourceLanguage,
    }, identity)
    return mapped ? { key: mediaKey(item), media: { ...item, ...mapped } } : null
  }))
  throwIfAborted(signal)
  const enriched = new Map(details.flatMap((result) =>
    result.status === 'fulfilled' && result.value ? [[result.value.key, result.value.media] as const] : []))
  return media.map((item) => enriched.get(mediaKey(item)) ?? item)
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

async function home(
  signal?: AbortSignal,
  rowIds?: string[],
  onUpdate?: CatalogHomeUpdate,
): Promise<CatalogHome> {
  const loadController = new AbortController()
  let budgetExpired = false
  const abortLoad = () => loadController.abort()
  if (signal?.aborted) loadController.abort()
  else signal?.addEventListener('abort', abortLoad, { once: true })
  const budgetTimer = setTimeout(() => {
    budgetExpired = true
    loadController.abort()
  }, JVM_HOME_LOAD_BUDGET_MS)
  const finishLoad = () => {
    clearTimeout(budgetTimer)
    signal?.removeEventListener('abort', abortLoad)
  }
  let sources: JvmCatalogSource[]
  try {
    // Source enumeration can legitimately continue warming its shared cache, but this Home caller
    // must remain bounded even when JVM startup itself gets stuck.
    sources = await waitForSignal(selectedSources(), loadController.signal)
  } catch (error) {
    finishLoad()
    throwIfAborted(signal)
    if (budgetExpired) {
      throw new Error('Aniyomi sources did not initialize within 12 seconds. Retry, or disable the source that is not responding.')
    }
    throw error
  }
  const available = jvmHomeRequests(sources)
  if (!available.length) {
    finishLoad()
    return { hero: [], sections: [] }
  }
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
  const loaded = new Map<string, Media[]>()
  let hero: Media[] = []
  const snapshot = (): CatalogHome => {
    const sections = selected.flatMap((request) => {
      const media = loaded.get(request.id) ?? []
      return media.length ? [{ id: request.id, title: request.title, media }] : []
    })
    const naturallyWide = [...loaded.values()].flat().filter((media) => media.bannerImage)
    return { hero: (hero.length ? hero : naturallyWide).slice(0, 10), sections }
  }
  const publish = () => {
    if (!signal?.aborted) onUpdate?.(snapshot())
  }
  try {
    const results = await settleWithConcurrency(requests, JVM_HOME_CONCURRENCY, async (request) => {
      const page = await homeSourcePage(request, loadController.signal)
      loaded.set(request.id, page.media)
      if (!hero.length && page.media.length) hero = page.media.slice(0, 10)
      publish()
      return { request, page }
    })
    throwIfAborted(signal)
    const current = snapshot()
    if (!current.sections.length && results.every((result) => result.status === 'rejected')) {
      if (budgetExpired) {
        throw new Error('Aniyomi sources did not return Home content within 12 seconds. Retry, or disable the source that is not responding.')
      }
      const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      throw failure?.reason ?? new Error('The selected Aniyomi sources did not return catalog data.')
    }
    // Home is already usable before this optional request begins. Enrich one featured item only,
    // after all rows, instead of inserting three speculative details ahead of the row queue.
    if (!loadController.signal.aborted && hero.length && !hero.some((item) => item.bannerImage)) {
      const pool = await enrichHero(hero.slice(0, 1), loadController.signal)
      const withBanners = pool.filter((item) => item.bannerImage)
      hero = (withBanners.length ? withBanners : pool).slice(0, 10)
      publish()
    }
    return snapshot()
  } catch (error) {
    throwIfAborted(signal)
    const current = snapshot()
    if (budgetExpired && (current.hero.length || current.sections.length)) return current
    if (budgetExpired) {
      throw new Error('Aniyomi sources did not return Home content within 12 seconds. Retry, or disable the source that is not responding.')
    }
    throw error
  } finally {
    finishLoad()
  }
}

async function search(request: CatalogSearchRequest): Promise<CatalogPage> {
  const sources = await selectedSources()
  const searchedSources = request.sourceId
    ? sources.filter((source) => source.id === request.sourceId)
    : sources
  if (!searchedSources.length) {
    throw new CatalogConfigurationError('The selected Aniyomi source is no longer enabled.')
  }
  const page = Math.max(1, request.page ?? 1)
  const query = request.query?.trim() ?? ''
  const results = await Promise.allSettled(searchedSources.map((source) => {
    const method = query || request.jvmFilters?.length
      ? 'search' as const
      : (request.sort === 'recent' || request.sort === 'trending') && source.supportsLatest
        ? 'getLatestUpdates' as const
        : source.supportsPopular
          ? 'getPopular' as const
          : source.supportsLatest
            ? 'getLatestUpdates' as const
            : 'search' as const
    return sourcePage(
      source,
      method,
      page,
      request.signal,
      query,
      request.sourceId === source.id ? request.jvmFilters : undefined,
    )
  }))
  throwIfAborted(request.signal)
  if (results.every((result) => result.status === 'rejected')) {
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    throw failure?.reason ?? new Error('The selected Aniyomi sources did not return search results.')
  }
  // Multiple sources usually return the same show. Keep the first selected source's version so
  // search remains useful instead of filling the grid with visually identical cards.
  const unique = new Map<string, Media>()
  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    for (const media of result.value.media) {
      const key = (media.title.romaji ?? media.title.english ?? '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
      const identity = key || mediaKey(media)
      const existing = unique.get(identity)
      if (!existing) {
        unique.set(identity, media)
      } else if (media.catalog && media.catalog.id !== existing.catalog?.id) {
        existing.catalogAlternatives = [
          ...(existing.catalogAlternatives ?? []),
          media.catalog,
        ]
      }
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
  if (!source) throw new CatalogConfigurationError('The Aniyomi source that supplied this title is no longer installed or enabled.')
  throwIfAborted(signal)
  const request = {
    url: identity.url,
    title: identity.title,
    thumbnail_url: identity.cover ?? '',
  }
  const raw = signal
    ? await detailJvmCatalogSource(source.id, request, signal)
    : await detailJvmCatalogSource(source.id, request)
  throwIfAborted(signal)
  const media = mapJvmCatalogMedia(raw, source, identity)
  if (!media) return null
  media.videos = videosOf(raw.episodes)
  media.episodes = media.videos.length || undefined
  return media
}

export const jvmCatalog: CatalogProvider = {
  id: 'jvm',
  label: 'Aniyomi sources',
  capabilities: {
    anime: true, movies: false, series: true, search: true,
    episodes: true, cast: false, relations: false,
  },
  homeRows,
  home,
  search,
  detail,
}
