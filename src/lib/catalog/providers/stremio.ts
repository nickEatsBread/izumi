import { get } from 'svelte/store'
import { phttp } from '$lib/net/http'
import { CINEMETA_BASE, enabledAddonUrls, addonOriginId, normalizeBase } from '$lib/stremio/sources'
import { fetchManifest, type AddonCatalog, type AddonManifest, type AddonResource } from '$lib/stremio/manifest'
import { listProviderByAddonId } from '$lib/stremio/list-providers'
import type { Media, MediaSourceFacts, MediaVideo } from '$lib/anilist/types'
import {
  continueCatalogOf, heroCatalogOf, isSourceBase, isSourceOrigin, sourceAddon, sourceAddonForOrigin, sourceOriginForBase,
} from '../source-catalogs'
import { catalogHomeLayouts, resolveCatalogHomeRows, type CatalogHomeTarget } from '../home-layout'
import { CONTINUE_HOME_ROW } from '../home-options'
import { compatibilityMediaId, type CatalogContentType, type MediaRef } from '../identity'
import { CatalogConfigurationError, SourceSignInError, type CatalogHome, type CatalogHomeRowOption, type CatalogPage, type CatalogProvider, type CatalogSearchRequest } from '../types'
import { enrichOmdbRatings } from './omdb'
import { interleaveFeatured, rankFeaturedMedia } from '../featured-context'

interface StremioVideo {
  id?: string
  title?: string
  /** Metadata add-ons name an episode here (`title` is older, and often absent). */
  name?: string
  season?: number
  episode?: number
  released?: string
  thumbnail?: string
  overview?: string
  streams?: import('$lib/stremio/parse').Stream[]
  /** izumi extras a source catalog may add (progress). Other clients ignore them. */
  izumi?: unknown
}

export interface StremioMeta {
  id?: string
  type?: string
  name?: string
  poster?: string
  posterShape?: 'poster' | 'square' | 'landscape'
  background?: string
  logo?: string
  description?: string
  releaseInfo?: string
  released?: string
  genres?: string[]
  imdbRating?: string
  runtime?: string
  director?: string[]
  writer?: string[]
  cast?: string[]
  country?: string
  language?: string
  awards?: string
  genre?: string[]
  trailers?: { source?: string; type?: string }[]
  videos?: StremioVideo[]
  /** izumi extras a source catalog may add (rating, audio, card progress, watchlist). */
  izumi?: unknown
}

const contentType = (type?: string): CatalogContentType => type === 'movie'
  ? 'movie' : type === 'anime' ? 'anime' : type === 'manga' ? 'manga' : 'series'

export interface StremioIdentity {
  addonId: string
  type: string
  id: string
  /** Catalog-summary facts used to ensure the meta endpoint answers for the card that was clicked. */
  expectedTitle?: string
  expectedYear?: number
}

/** URL-safe stable identity. It contains no configured URL or credentials, only the add-on's
 * fingerprint, Stremio type, and native meta id. */
export const encodeStremioIdentity = (addonId: string, type: string, id: string): string =>
  encodeURIComponent(JSON.stringify([addonId, type, id]))

export function decodeStremioIdentity(value: string): StremioIdentity | null {
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as unknown
    if (!Array.isArray(parsed) || parsed.length !== 3 || parsed.some((item) => typeof item !== 'string')) return null
    return { addonId: parsed[0], type: parsed[1], id: parsed[2] }
  } catch { return null }
}

function idsOf(value: string): Media['externalIds'] {
  if (/^tt\d+$/i.test(value)) return { imdb: value }
  const kitsu = /^kitsu:(\d+)/i.exec(value)?.[1]
  if (kitsu) return { kitsu: Number(kitsu) }
  const tmdb = /^tmdb:(?:(?:movie|tv|series):)?(\d+)/i.exec(value)?.[1]
  if (tmdb) return { tmdb: Number(tmdb) }
  return {}
}

function year(value?: string): number | undefined {
  const match = /\b(18|19|20|21)\d{2}\b/.exec(value ?? '')
  return match ? Number(match[0]) : undefined
}

/** A source's own base keeps its loopback http address; public add-ons are normalized to https. */
const urlBase = (base: string): string => (isSourceBase(base) ? base.replace(/\/+$/, '') : normalizeBase(base))
/** Title identities name a source by its package, not its port, which changes between launches. */
const originOf = (base: string): string => sourceOriginForBase(base) ?? addonOriginId(base)

const shortText = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : undefined
const unit = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : undefined)
const secondsOf = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined)
/** A URL izumi may call on a source's behalf: only on that source's own address. */
function ownUrl(value: unknown, base: string): string | undefined {
  if (typeof value !== 'string' || !isSourceBase(base)) return undefined
  try {
    const url = new URL(value)
    return url.origin === new URL(base).origin ? url.href : undefined
  } catch {
    return undefined
  }
}

/** The `izumi` extras on a meta, checked field by field: they come from the add-on. */
export function sourceFacts(raw: unknown, base: string): MediaSourceFacts | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Record<string, unknown>
  const card = (value.continue ?? value.episode) as Record<string, unknown> | undefined
  const upNext = value.upNext as Record<string, unknown> | undefined
  const upNextId = upNext && typeof upNext === 'object' ? shortText(upNext.videoId, 256) : undefined
  const watchlistUrl = ownUrl(value.watchlistUrl, base)
  const seasons = (Array.isArray(value.seasons) ? value.seasons.slice(0, 100) : []).flatMap((season) => {
    const entry = season as Record<string, unknown> | null
    const number = entry?.number
    const name = shortText(entry?.title, 80)
    return typeof number === 'number' && Number.isInteger(number) && number >= 0 && name ? [{ number, title: name }] : []
  })
  const facts: MediaSourceFacts = {
    ...(shortText(value.rating, 12) ? { rating: shortText(value.rating, 12) } : {}),
    ...(shortText(value.audio, 32) ? { audio: shortText(value.audio, 32) } : {}),
    ...(card && typeof card === 'object' ? {
      card: {
        videoId: shortText(card.videoId, 256),
        label: shortText(card.label, 24),
        remainingSec: secondsOf(card.remainingSec),
        progress: unit(card.progress),
      },
    } : {}),
    ...(value.isNew === true ? { isNew: true } : {}),
    ...(upNextId ? { upNext: { videoId: upNextId, label: shortText(upNext!.label, 24), playhead: secondsOf(upNext!.playhead) } } : {}),
    ...(typeof value.watchlist === 'boolean' ? { watchlist: value.watchlist } : {}),
    ...(watchlistUrl ? { watchlistUrl } : {}),
    ...(seasons.length ? { seasons } : {}),
  }
  return Object.keys(facts).length ? facts : undefined
}

/** `izumi.track` on a source's video: the AniList entry and episode it is. Whole positive numbers only. */
function videoTrack(raw: unknown): Pick<MediaVideo, 'track'> {
  const track = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).track : undefined
  if (!track || typeof track !== 'object') return {}
  const { anilist, mal, episode } = track as Record<string, unknown>
  const id = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined)
  if (!id(anilist) || !id(episode)) return {}
  return { track: { anilist: id(anilist)!, episode: id(episode)!, ...(id(mal) ? { mal: id(mal) } : {}) } }
}

function videoProgress(raw: unknown): Pick<MediaVideo, 'progress' | 'playhead' | 'watched' | 'durationSec'> {
  if (!raw || typeof raw !== 'object') return {}
  const value = raw as Record<string, unknown>
  return {
    ...(unit(value.progress) !== undefined ? { progress: unit(value.progress) } : {}),
    ...(secondsOf(value.playhead) !== undefined ? { playhead: secondsOf(value.playhead) } : {}),
    ...(typeof value.watched === 'boolean' ? { watched: value.watched } : {}),
    ...(secondsOf(value.durationSec) !== undefined ? { durationSec: secondsOf(value.durationSec) } : {}),
  }
}

function runtimeMinutes(value?: string): number | undefined {
  if (!value) return undefined
  const hours = Number(/(\d+)\s*h/i.exec(value)?.[1] ?? 0)
  const minutes = Number(/(\d+)\s*m/i.exec(value)?.[1] ?? 0)
  return hours * 60 + minutes || Number(/\d+/.exec(value)?.[0]) || undefined
}

const normalizedMetaTitle = (value: string): string => value
  .replace(/\s*[([{]\s*(?:18|19|20|21)\d{2}\s*[)\]}]\s*$/, '')
  .normalize('NFKD')
  .replace(/\p{M}/gu, '')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()
  .replace(/\s+/g, ' ')

/** A Stremio meta response must identify the native item and summary title that were requested. */
export function stremioMetaMatchesIdentity(raw: StremioMeta, identity: StremioIdentity): boolean {
  if (!raw.id || raw.id !== identity.id) return false
  if (identity.expectedTitle) {
    if (!raw.name || normalizedMetaTitle(raw.name) !== normalizedMetaTitle(identity.expectedTitle)) return false
  }
  const actualYear = year(raw.releaseInfo ?? raw.released)
  if (identity.expectedYear && actualYear && actualYear !== identity.expectedYear) return false
  return true
}

export function mapStremioMeta(raw: StremioMeta, base: string, forcedType?: string, forcedIdentity?: string): Media | null {
  if (!raw.id || !raw.name) return null
  // Stremio catalogs can mix movies and series under a custom catalog type, so a row's explicit
  // type wins. `forcedType` is the fallback for the common compact-preview shape that omits it.
  const stremioType = raw.type ?? forcedType ?? 'series'
  const addonId = originOf(base)
  const releaseYear = year(raw.releaseInfo ?? raw.released)
  const opaqueId = forcedIdentity ?? encodeStremioIdentity(addonId, stremioType, raw.id)
  const ref = {
    provider: 'stremio' as const,
    type: contentType(stremioType),
    id: opaqueId,
    addonId,
    resourceType: stremioType,
  }
  const videos: MediaVideo[] = (raw.videos ?? []).map((video, index) => ({
    id: video.id,
    number: index + 1,
    season: video.season,
    episode: video.episode,
    title: video.title || video.name,
    overview: video.overview,
    thumbnail: video.thumbnail,
    released: video.released,
    streams: video.streams,
    ...videoProgress(video.izumi),
    ...videoTrack(video.izumi),
  }))
  if (!videos.length && stremioType === 'movie') videos.push({ id: raw.id, number: 1, title: raw.name })
  const rating = Number(raw.imdbRating)
  const source = sourceFacts(raw.izumi, base)
  return {
    ...(source ? { sourceFacts: source } : {}),
    ...(source?.rating ? { contentRating: source.rating } : {}),
    id: compatibilityMediaId(ref),
    catalog: ref,
    externalIds: idsOf(raw.id),
    type: ref.type === 'movie' ? 'MOVIE' : ref.type === 'manga' ? 'MANGA' : 'SERIES',
    title: { english: raw.name, romaji: raw.name, userPreferred: raw.name },
    description: raw.description,
    creators: raw.writer?.length ? raw.writer : raw.director,
    format: ref.type === 'movie' ? 'MOVIE' : ref.type === 'manga' ? 'MANGA' : 'TV',
    status: raw.releaseInfo?.endsWith('-') ? 'RELEASING' : undefined,
    episodes: ref.type === 'movie' ? 1 : videos.length || undefined,
    duration: runtimeMinutes(raw.runtime),
    averageScore: Number.isFinite(rating) && rating > 0 ? Math.round(rating * 10) : undefined,
    ratings: Number.isFinite(rating) && rating > 0 && rating <= 10
      ? [{ source: 'IMDb', score: rating, scale: 10 }]
      : undefined,
    genres: raw.genres ?? raw.genre ?? [],
    countryOfOrigin: raw.country,
    originalLanguage: raw.language,
    awards: raw.awards,
    releaseDate: raw.released?.slice(0, 10),
    startDate: releaseYear ? { year: releaseYear } : undefined,
    coverImage: { extraLarge: raw.poster, large: raw.poster, medium: raw.poster },
    bannerImage: raw.background,
    logoImage: raw.logo,
    trailer: raw.trailers?.find((trailer) => trailer.source)?.source
      ? { id: raw.trailers.find((trailer) => trailer.source)!.source, site: 'youtube' }
      : null,
    videos,
    characters: { edges: (raw.cast ?? []).map((name, index) => ({
      role: 'Cast', node: { id: -(index + 1), name: { full: name } },
    })) },
    staff: { edges: (raw.director ?? []).map((name, index) => ({
      role: 'Director', node: { id: -(index + 1), name: { full: name } },
    })) },
  }
}

// If an add-on later answers its native meta route with a different item, the card the user
// actually clicked is the safe fallback. Bound the cache for long-running sessions.
const summaryCache = new Map<string, Media>()
function rememberSummary(media: Media): Media {
  const id = media.catalog?.id
  if (!id) return media
  summaryCache.delete(id)
  summaryCache.set(id, media)
  if (summaryCache.size > 1000) summaryCache.delete(summaryCache.keys().next().value as string)
  return media
}

const searchText = (value?: string): string => (value ?? '')
  .normalize('NFKD')
  .replace(/\p{M}/gu, '')
  .toLocaleLowerCase()
  .trim()

const releaseDateOf = (media: Media): string | undefined => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(media.releaseDate ?? '')) return media.releaseDate
  return media.startDate?.year ? `${media.startDate.year}-01-01` : undefined
}

/** Stremio's catalog protocol standardizes search/genre/skip only. Rich filters therefore run
 * against the metadata returned by each add-on. Keep this pure so every boundary and sort order
 * can be verified without network fixtures. Missing metadata does not satisfy an active filter. */
export function filterAndSortStremioMedia(media: Media[], request: CatalogSearchRequest): Media[] {
  const excluded = new Set((request.excludedGenres ?? []).map(searchText))
  const language = searchText(request.language)
  const country = searchText(request.country)
  const filtered = media.filter((item) => {
    if (request.sourceAddonId && item.catalog?.addonId !== request.sourceAddonId) return false
    if (request.year && item.startDate?.year !== request.year) return false
    if (excluded.size && item.genres?.some((genre) => excluded.has(searchText(genre)))) return false
    if (request.withPoster && !item.coverImage?.extraLarge && !item.coverImage?.large && !item.coverImage?.medium) return false
    if (language && !searchText(item.originalLanguage).includes(language)) return false
    if (country && !searchText(item.countryOfOrigin).includes(country)) return false
    if (request.minScore != null && (item.averageScore == null || item.averageScore < request.minScore)) return false
    if (request.maxScore != null && (item.averageScore == null || item.averageScore > request.maxScore)) return false
    if (request.runtimeMin != null && (item.duration == null || item.duration < request.runtimeMin)) return false
    if (request.runtimeMax != null && (item.duration == null || item.duration > request.runtimeMax)) return false
    const releaseDate = releaseDateOf(item)
    if (request.releaseDateFrom && (!releaseDate || releaseDate < request.releaseDateFrom)) return false
    if (request.releaseDateTo && (!releaseDate || releaseDate > request.releaseDateTo)) return false
    return true
  })

  const titleOf = (item: Media) => item.title.userPreferred ?? item.title.english ?? item.title.romaji ?? ''
  const yearOf = (item: Media) => item.startDate?.year ?? 0
  if (request.sort === 'rating') return filtered.sort((left, right) => (right.averageScore ?? -1) - (left.averageScore ?? -1))
  if (request.sort === 'recent') return filtered.sort((left, right) => yearOf(right) - yearOf(left))
  if (request.sort === 'oldest') return filtered.sort((left, right) => (yearOf(left) || Number.MAX_SAFE_INTEGER) - (yearOf(right) || Number.MAX_SAFE_INTEGER))
  if (request.sort === 'title') return filtered.sort((left, right) => titleOf(left).localeCompare(titleOf(right)))
  return filtered
}

const hasResource = (manifest: AddonManifest, name: string) => (manifest.resources ?? []).some((resource: AddonResource) =>
  typeof resource === 'string' ? resource === name : resource.name === name)

/** Some established catalog add-ons (notably Trakt TV) publish working `/catalog` routes but omit
 * `catalog` from `resources`; MDBList correctly declares `catalog` but deliberately has no `meta`
 * endpoint. A non-empty catalog declaration is sufficient to browse either shape. Detail can be
 * supplied by the add-on, Cinemeta for IMDb ids, or the catalog summary itself. */
export function supportsStremioCatalogManifest(manifest: AddonManifest | null): manifest is AddonManifest {
  return !!manifest?.catalogs?.length
}

function extraPath(extra: Record<string, string | number | undefined>): string {
  const entries = Object.entries(extra).filter(([, value]) => value != null && value !== '')
  if (!entries.length) return ''
  return '/' + entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&')
}

export function stremioCatalogUrl(base: string, entry: Pick<AddonCatalog, 'type' | 'id'>, extra: Record<string, string | number | undefined> = {}): string {
  return `${urlBase(base)}/catalog/${encodeURIComponent(entry.type)}/${encodeURIComponent(entry.id)}${extraPath(extra)}.json`
}

export function stremioMetaUrl(base: string, type: string, id: string): string {
  return `${urlBase(base)}/meta/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await phttp(url, { signal, timeoutMs: 15_000, maxBytes: 4 * 1024 * 1024 })
  if (!response.ok) throw Object.assign(new Error(`Stremio metadata add-on returned HTTP ${response.status}`), { status: response.status })
  return response.json() as Promise<T>
}

async function catalog(base: string, entry: AddonCatalog, extra: Record<string, string | number | undefined>, signal?: AbortSignal) {
  const normalized = urlBase(base)
  const url = stremioCatalogUrl(normalized, entry, extra)
  const response = await getJson<{ metas?: StremioMeta[] }>(url, signal)
  return (response.metas ?? []).flatMap((meta) => {
    const media = mapStremioMeta(meta, normalized, entry.type)
    return media ? [rememberSummary(media)] : []
  })
}

type SourceLoader = () => Promise<StremioCatalogSource[]>

async function manifests(): Promise<{ base: string; manifest: AddonManifest }[]> {
  const bases = get(enabledAddonUrls)
  if (!bases.length) throw new CatalogConfigurationError('Add a Stremio metadata add-on in Settings → Sources or connect a list provider in Accounts first.')
  const loaded = await Promise.all(bases.map(async (base) => ({ base: normalizeBase(base), manifest: await fetchManifest(base) })))
  const capable = loaded.flatMap((item) => supportsStremioCatalogManifest(item.manifest)
    ? [{ base: item.base, manifest: item.manifest }] : [])
  if (!capable.length) throw new CatalogConfigurationError('None of the enabled Stremio add-ons declares a catalog.')
  return capable
}

const canSearch = (entry: AddonCatalog) => (entry.extra ?? []).some((extra) => extra.name === 'search')

export interface StremioCatalogVariant {
  key: string
  extra: Record<string, string>
  title: string
  description: string
  defaultEnabled: boolean
}

const contentLabel = (type: string): string => type === 'movie' ? 'Movies'
  : type === 'series' ? 'TV'
  : type === 'anime' ? 'Anime'
  : type === 'manga' ? 'Manga'
  : type.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())

function catalogTitle(entry: AddonCatalog): string {
  const label = contentLabel(entry.type)
  const alreadyNamed = entry.type === 'movie' ? /\bmovies?\b/i.test(entry.name)
    : entry.type === 'series' ? /\b(?:tv|series|shows?)\b/i.test(entry.name)
    : new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(entry.name)
  return alreadyNamed ? entry.name : `${entry.name} ${label}`
}

const extraKey = (extra: Record<string, string>): string => Object.entries(extra)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([name, value]) => `${name}=${value}`)
  .join('&')

/** Turn every finite manifest filter into a Home row. Required filters (Cinemeta's New-by-year
 * catalogs) become their valid concrete rows; optional filters keep the unfiltered row and add
 * opt-in variants. Required user-history inputs without declared options remain non-browsable. */
export function stremioCatalogVariants(entry: AddonCatalog): StremioCatalogVariant[] {
  if (entry.izumi?.home === false) return []
  const extras = entry.extra ?? []
  const required = extras.filter((extra) => extra.isRequired)
  if (required.some((extra) => !extra.options?.length)) return []

  let bases: Record<string, string>[] = [{}]
  for (const extra of required) {
    bases = bases.flatMap((base) => (extra.options ?? []).map((value) => ({ ...base, [extra.name]: value })))
  }
  const optional = entry.izumi?.homeFilters === false ? [] : extras.filter((extra) => !extra.isRequired && extra.options?.length)
  const values = [
    ...bases.map((extra) => ({ extra, defaultEnabled: required.length === 0 })),
    ...bases.flatMap((base) => optional.flatMap((extra) => (extra.options ?? []).map((value) => ({
      extra: { ...base, [extra.name]: value },
      defaultEnabled: false,
    })))),
  ]
  const seen = new Set<string>()
  const baseTitle = catalogTitle(entry)
  return values.flatMap(({ extra, defaultEnabled }) => {
    const key = extraKey(extra)
    if (seen.has(key)) return []
    seen.add(key)
    const filters = Object.values(extra)
    return [{
      key,
      extra,
      title: filters.length ? `${baseTitle} · ${filters.join(' · ')}` : baseTitle,
      description: filters.length
        ? `${baseTitle}, filtered to ${filters.join(' and ')}.`
        : `${baseTitle} from this metadata add-on.`,
      defaultEnabled,
    }]
  })
}

type StremioHomeEntry = {
  base: string
  manifest: AddonManifest
  entry: AddonCatalog
  id: string
  extra: Record<string, string>
  title: string
  description: string
  group: string
  defaultEnabled: boolean
  rankLabel: string
}

export interface StremioCatalogSource {
  base: string
  manifest: AddonManifest
}

function stremioHomeEntries(sources: StremioCatalogSource[]): StremioHomeEntry[] {
  const multipleSources = sources.length > 1
  return sources.flatMap(({ base, manifest }) => (manifest.catalogs ?? []).flatMap((entry) =>
    stremioCatalogVariants(entry).map((variant) => {
      const rootId = `${originOf(base)}:${entry.type}:${entry.id}`
      // A source names its own rows ("Continue Watching", "Popular"): no type suffix.
      const own = isSourceBase(base) ? (Object.keys(variant.extra).length ? variant.title : entry.name) : variant.title
      const title = multipleSources ? `${own} · ${manifest.name}` : own
      const trending = /^trending(?:\s+now)?$/i.test(entry.name.trim())
      const listProvider = listProviderByAddonId(manifest.id)
      return {
        base,
        manifest,
        entry,
        id: variant.key ? `${rootId}:${encodeURIComponent(variant.key)}` : rootId,
        extra: variant.extra,
        title,
        description: variant.description,
        group: listProvider
          ? `${listProvider.name} lists · ${contentLabel(entry.type)}`
          : `${manifest.name} · ${contentLabel(entry.type)}`,
        // Account-backed lists are personal choices. Discover them in Available rows and let the
        // user add only the watchlists/recommendations/custom lists they actually want on Home.
        defaultEnabled: listProvider ? false : variant.defaultEnabled,
        rankLabel: trending ? `${contentLabel(entry.type)} Today` : title,
      }
    })))
}

function stremioHomeOptions(entries: StremioHomeEntry[]): CatalogHomeRowOption[] {
  return [CONTINUE_HOME_ROW, ...entries.map(({ id, title, description, group, defaultEnabled }) => ({
    id,
    title,
    description,
    group,
    defaultEnabled,
  }))]
}

/** Pure manifest-to-row adapter shared with Accounts so each personal list can be shown as an
 * individually addable Home element without making another network request. */
export function stremioHomeRowOptionsForSources(sources: StremioCatalogSource[]): CatalogHomeRowOption[] {
  return stremioHomeOptions(stremioHomeEntries(sources))
}

/** A source's featured and Continue Watching catalogs have their own places on Home, not rows. */
function sourceSpecials(sources: StremioCatalogSource[]) {
  const source = sources.length === 1 && isSourceBase(sources[0]!.base) ? sources[0]! : undefined
  const hero = source ? heroCatalogOf(source.manifest) : undefined
  const resume = source ? continueCatalogOf(source.manifest) : undefined
  const special = new Set([hero, resume].filter(Boolean).map((entry) => `${originOf(source!.base)}:${entry!.type}:${entry!.id}`))
  return { source, hero, resume, special }
}

async function homeRows(load: SourceLoader): Promise<CatalogHomeRowOption[]> {
  const sources = await load()
  const { special } = sourceSpecials(sources)
  return stremioHomeRowOptionsForSources(sources).filter((row) => !special.has(row.id))
}

async function home(load: SourceLoader, layoutKey: CatalogHomeTarget, signal?: AbortSignal, rowIds?: string[]): Promise<CatalogHome> {
  const sources = await load()
  const { source, hero: heroEntry, resume, special } = sourceSpecials(sources)
  const available = stremioHomeEntries(sources).filter((entry) => !special.has(entry.id))
  const byId = new Map(available.map((entry) => [entry.id, entry]))
  // Keep the provider safety cap, but apply it after customization so a user can promote a row
  // from a large add-on manifest by hiding or moving less useful catalogs.
  const options = stremioHomeOptions(available)
  const configured = rowIds
    ? options.map((row) => ({ ...row, enabled: rowIds.includes(row.id) }))
    : resolveCatalogHomeRows(layoutKey, options, get(catalogHomeLayouts))
  const entries = configured
    .filter((row) => row.enabled && row.id !== 'continue').flatMap((row) => byId.get(row.id) ?? []).slice(0, source ? 24 : 16)
  const [rows, heroMedia, resumeMedia] = await Promise.all([
    Promise.all(entries.map(async ({ base, entry, id, extra, title, rankLabel }) => ({
      id,
      title,
      rankLabel,
      media: await catalog(base, entry, extra, signal).catch(() => []),
      more: canSearch(entry) ? { type: contentType(entry.type) } : undefined,
    }))),
    source && heroEntry ? catalog(source.base, heroEntry, {}, signal).catch(() => []) : Promise.resolve([]),
    source && resume ? catalog(source.base, resume, {}, signal).catch(() => []) : Promise.resolve([]),
  ])
  const sections = rows.filter((row) => row.media.length)
  // Give every enabled catalog a turn in the banner instead of letting the first 100-item row
  // consume every slot. The provider's own rank and our type-aware label stay attached.
  const all = interleaveFeatured(
    sections.map((section) => rankFeaturedMedia(section.media, section.rankLabel)),
    40,
  )
  const hero = all.filter((media) => media.bannerImage)
  const resumeId = source && resume ? `${originOf(source.base)}:${resume.type}:${resume.id}` : undefined
  const resumeSection = resumeId && resumeMedia.length
    ? [{ id: resumeId, title: resume!.name, media: resumeMedia }]
    : []
  return {
    // A source's own featured titles lead its banner; otherwise every row gets a turn.
    hero: heroMedia.length ? heroMedia.slice(0, 10) : (hero.length ? hero : all).slice(0, 10),
    sections: [...resumeSection, ...sections.map(({ rankLabel: _rankLabel, ...section }) => section)],
    ...(resumeSection.length ? { continue: resumeId } : {}),
  }
}

async function search(load: SourceLoader, request: CatalogSearchRequest): Promise<CatalogPage> {
  const sources = await load()
  const entries = sources.flatMap(({ base, manifest }) => (manifest.catalogs ?? [])
    .filter((entry) => canSearch(entry)
      && (!request.sourceAddonId || originOf(base) === request.sourceAddonId)
      && (request.type == null || request.type === 'all' || contentType(entry.type) === request.type))
    .map((entry) => ({ base, manifest, entry })))
  if (!entries.length) throw new CatalogConfigurationError('The enabled Stremio metadata add-ons do not declare searchable catalogs.')
  const skip = (Math.max(1, request.page ?? 1) - 1) * 100
  const pages = await Promise.all(entries.map(({ base, entry }) => catalog(base, entry, {
    search: request.query?.trim(), genre: request.genre, skip,
  }, request.signal).catch(() => [])))
  const seen = new Set<string>()
  const media = pages.flat().filter((item) => {
    const key = item.catalog?.id ?? String(item.id)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return {
    media: filterAndSortStremioMedia(media, request),
    page: request.page ?? 1,
    hasNextPage: pages.some((page) => page.length >= 100),
  }
}

async function genres(load: SourceLoader): Promise<string[]> {
  const sources = await load()
  const values = sources.flatMap(({ manifest }) => (manifest.catalogs ?? []).flatMap((entry) => [
    ...(entry.genres ?? []),
    ...(entry.extra ?? []).filter((extra) => extra.name === 'genre').flatMap((extra) => extra.options ?? []),
  ]))
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

async function searchOptions(load: SourceLoader) {
  const sources = await load()
  return {
    sources: sources.map(({ base, manifest }) => ({ value: originOf(base), label: manifest.name })),
  }
}

async function loadDetail(ref: MediaRef, signal?: AbortSignal, includeExternalRatings = true): Promise<Media | null> {
  if (ref.provider !== 'stremio') return null
  const decoded = decodeStremioIdentity(ref.id)
  if (!decoded) return null
  // A source's own catalog: its live address comes from its running service.
  const sourceAddonInfo = isSourceOrigin(decoded.addonId) ? await sourceAddonForOrigin(decoded.addonId) : undefined
  if (isSourceOrigin(decoded.addonId) && !sourceAddonInfo) {
    throw new CatalogConfigurationError('The source that supplied this title is not available.')
  }
  const base = sourceAddonInfo?.base ?? get(enabledAddonUrls).map(normalizeBase).find((url) => addonOriginId(url) === decoded.addonId)
  if (!base) throw new CatalogConfigurationError('The Stremio metadata add-on that supplied this item is no longer enabled.')
  const summary = summaryCache.get(ref.id)
  // A source's ids are its own: a card it titles differently ("… S3" on its banner) still opens that
  // title's details, so only the id is checked there.
  const expected: StremioIdentity = summary && !sourceAddonInfo ? {
    ...decoded,
    expectedTitle: summary.title.english ?? summary.title.romaji ?? summary.title.userPreferred,
    expectedYear: summary.startDate?.year,
  } : decoded

  const manifest = sourceAddonInfo?.manifest ?? await fetchManifest(base).catch(() => null)
  const candidates = [
    ...(manifest && hasResource(manifest, 'meta') ? [{ base, identity: expected }] : []),
    ...(/^tt\d+$/i.test(decoded.id) && (decoded.type === 'movie' || decoded.type === 'series')
      // Cinemeta's route is keyed by the exact IMDb id. Its localized title may legitimately
      // differ from the catalog card, so the id/type contract is the authoritative check here.
      ? [{ base: CINEMETA_BASE, identity: decoded }]
      : []),
  ]
  const seenCandidates = new Set<string>()
  for (const candidate of candidates) {
    if (seenCandidates.has(candidate.base)) continue
    seenCandidates.add(candidate.base)
    try {
      const response = await getJson<{ meta?: StremioMeta }>(
        stremioMetaUrl(candidate.base, decoded.type, decoded.id), signal,
      )
      if (!response.meta || !stremioMetaMatchesIdentity(response.meta, candidate.identity)) continue
      const media = mapStremioMeta(response.meta, base, decoded.type, ref.id)
      if (media) return includeExternalRatings ? enrichOmdbRatings(media, signal) : media
    } catch (error) {
      if (signal?.aborted) throw error
      // A signed-out source says so: its page then asks for the sign-in instead of "not found".
      if (sourceAddonInfo && candidate.base === base && (error as { status?: number }).status === 401) {
        throw new SourceSignInError('Sign in to this source to see its titles.', sourceAddonInfo.packageId)
      }
      // Catalog-only add-ons are expected to miss this route. A transient add-on metadata error
      // should likewise fall through to Cinemeta/the already rendered catalog record.
    }
  }
  return summary ? includeExternalRatings ? enrichOmdbRatings(summary, signal) : summary : null
}

const detail = (ref: MediaRef, signal?: AbortSignal) => loadDetail(ref, signal, true)
const presentation = (ref: MediaRef, signal?: AbortSignal) => loadDetail(ref, signal, false)

// A source's screen is still a Stremio provider: its titles open, search and play the Stremio way.
function stremioProvider(label: string, load: SourceLoader, layoutKey: CatalogHomeTarget): CatalogProvider {
  return {
    id: 'stremio',
    label,
    capabilities: {
      anime: true, movies: true, series: true, search: true, genres: true,
      schedule: true, episodes: true, cast: true, relations: false,
    },
    homeRows: () => homeRows(load),
    home: (signal, rowIds) => home(load, layoutKey, signal, rowIds),
    search: (request) => search(load, request),
    genres: () => genres(load),
    searchOptions: () => searchOptions(load),
    detail,
    presentation,
  }
}

export const stremioCatalog: CatalogProvider = stremioProvider('Stremio metadata', manifests, 'stremio')

/** A source's own catalog screen: the Stremio provider over that one source's add-on. */
export function sourceCatalogProvider(packageId: string, label: string): CatalogProvider {
  return stremioProvider(label, async () => {
    const addon = await sourceAddon(packageId).catch((error) => {
      throw new CatalogConfigurationError(error instanceof Error ? error.message : String(error))
    })
    return [{ base: addon.base, manifest: addon.manifest }]
  }, `source:${packageId}`)
}
