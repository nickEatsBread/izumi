import { get } from 'svelte/store'
import { phttp } from '$lib/net/http'
import { enabledAddonUrls, addonOriginId, normalizeBase } from '$lib/stremio/sources'
import { fetchManifest, type AddonCatalog, type AddonManifest, type AddonResource } from '$lib/stremio/manifest'
import type { Media, MediaVideo } from '$lib/anilist/types'
import { catalogHomeLayouts, resolveCatalogHomeRows } from '../home-layout'
import { CONTINUE_HOME_ROW } from '../home-options'
import { compatibilityMediaId, type CatalogContentType, type MediaRef } from '../identity'
import { CatalogConfigurationError, type CatalogHome, type CatalogHomeRowOption, type CatalogPage, type CatalogProvider, type CatalogSearchRequest } from '../types'

interface StremioVideo {
  id?: string
  title?: string
  season?: number
  episode?: number
  released?: string
  thumbnail?: string
  overview?: string
}

interface StremioMeta {
  id?: string
  type?: string
  name?: string
  poster?: string
  background?: string
  logo?: string
  description?: string
  releaseInfo?: string
  released?: string
  genres?: string[]
  imdbRating?: string
  runtime?: string
  director?: string[]
  cast?: string[]
  trailers?: { source?: string; type?: string }[]
  videos?: StremioVideo[]
}

const contentType = (type?: string): CatalogContentType => type === 'movie'
  ? 'movie' : type === 'anime' ? 'anime' : type === 'manga' ? 'manga' : 'series'

/** URL-safe opaque identity. It contains no configured URL or credentials, only the add-on's
 * fingerprint, Stremio type and native meta id. */
export const encodeStremioIdentity = (addonId: string, type: string, id: string): string =>
  encodeURIComponent(JSON.stringify([addonId, type, id]))

export function decodeStremioIdentity(value: string): { addonId: string; type: string; id: string } | null {
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
  const tmdb = /^tmdb:(\d+)/i.exec(value)?.[1]
  if (tmdb) return { tmdb: Number(tmdb) }
  return {}
}

function year(value?: string): number | undefined {
  const match = /\b(18|19|20|21)\d{2}\b/.exec(value ?? '')
  return match ? Number(match[0]) : undefined
}

function runtimeMinutes(value?: string): number | undefined {
  if (!value) return undefined
  const hours = Number(/(\d+)\s*h/i.exec(value)?.[1] ?? 0)
  const minutes = Number(/(\d+)\s*m/i.exec(value)?.[1] ?? 0)
  return hours * 60 + minutes || Number(/\d+/.exec(value)?.[0]) || undefined
}

function mapMeta(raw: StremioMeta, base: string, forcedType?: string): Media | null {
  if (!raw.id || !raw.name) return null
  const stremioType = raw.type ?? forcedType ?? 'series'
  const addonId = addonOriginId(base)
  const opaqueId = encodeStremioIdentity(addonId, stremioType, raw.id)
  const ref = { provider: 'stremio' as const, type: contentType(stremioType), id: opaqueId, addonId }
  const videos: MediaVideo[] = (raw.videos ?? []).map((video, index) => ({
    id: video.id,
    number: index + 1,
    season: video.season,
    episode: video.episode,
    title: video.title,
    overview: video.overview,
    thumbnail: video.thumbnail,
    released: video.released,
  }))
  if (!videos.length && stremioType === 'movie') videos.push({ id: raw.id, number: 1, title: raw.name })
  const rating = Number(raw.imdbRating)
  const releaseYear = year(raw.releaseInfo ?? raw.released)
  return {
    id: compatibilityMediaId(ref),
    catalog: ref,
    externalIds: idsOf(raw.id),
    type: ref.type === 'movie' ? 'MOVIE' : ref.type === 'manga' ? 'MANGA' : 'SERIES',
    title: { english: raw.name, romaji: raw.name, userPreferred: raw.name },
    description: raw.description,
    format: ref.type === 'movie' ? 'MOVIE' : ref.type === 'manga' ? 'MANGA' : 'TV',
    status: raw.releaseInfo?.endsWith('-') ? 'RELEASING' : undefined,
    episodes: ref.type === 'movie' ? 1 : videos.length || undefined,
    duration: runtimeMinutes(raw.runtime),
    averageScore: Number.isFinite(rating) && rating > 0 ? Math.round(rating * 10) : undefined,
    genres: raw.genres ?? [],
    startDate: releaseYear ? { year: releaseYear } : undefined,
    coverImage: { extraLarge: raw.poster, large: raw.poster, medium: raw.poster },
    bannerImage: raw.background,
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

const hasResource = (manifest: AddonManifest, name: string) => (manifest.resources ?? []).some((resource: AddonResource) =>
  typeof resource === 'string' ? resource === name : resource.name === name)

function extraPath(extra: Record<string, string | number | undefined>): string {
  const entries = Object.entries(extra).filter(([, value]) => value != null && value !== '')
  if (!entries.length) return ''
  return '/' + entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&')
}

export function stremioCatalogUrl(base: string, entry: Pick<AddonCatalog, 'type' | 'id'>, extra: Record<string, string | number | undefined> = {}): string {
  return `${normalizeBase(base)}/catalog/${encodeURIComponent(entry.type)}/${encodeURIComponent(entry.id)}${extraPath(extra)}.json`
}

export function stremioMetaUrl(base: string, type: string, id: string): string {
  return `${normalizeBase(base)}/meta/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await phttp(url, { signal, timeoutMs: 15_000, maxBytes: 4 * 1024 * 1024 })
  if (!response.ok) throw new Error(`Stremio metadata add-on returned HTTP ${response.status}`)
  return response.json() as Promise<T>
}

async function catalog(base: string, entry: AddonCatalog, extra: Record<string, string | number | undefined>, signal?: AbortSignal) {
  const normalized = normalizeBase(base)
  const url = stremioCatalogUrl(normalized, entry, extra)
  const response = await getJson<{ metas?: StremioMeta[] }>(url, signal)
  return (response.metas ?? []).flatMap((meta) => {
    const media = mapMeta(meta, normalized, entry.type)
    return media ? [media] : []
  })
}

async function manifests(): Promise<{ base: string; manifest: AddonManifest }[]> {
  const bases = get(enabledAddonUrls)
  if (!bases.length) throw new CatalogConfigurationError('Add a Stremio metadata add-on in Settings → Sources first.')
  const loaded = await Promise.all(bases.map(async (base) => ({ base: normalizeBase(base), manifest: await fetchManifest(base) })))
  const capable = loaded.flatMap((item) => item.manifest && hasResource(item.manifest, 'catalog')
    && hasResource(item.manifest, 'meta') && item.manifest.catalogs?.length
    ? [{ base: item.base, manifest: item.manifest }] : [])
  if (!capable.length) throw new CatalogConfigurationError('None of the enabled Stremio add-ons declares both catalog and meta resources.')
  return capable
}

const canBrowse = (entry: AddonCatalog) => !(entry.extra ?? []).some((extra) => extra.isRequired)
const canSearch = (entry: AddonCatalog) => (entry.extra ?? []).some((extra) => extra.name === 'search')

type StremioHomeEntry = { base: string; manifest: AddonManifest; entry: AddonCatalog; id: string }

function stremioHomeEntries(sources: { base: string; manifest: AddonManifest }[]): StremioHomeEntry[] {
  return sources.flatMap(({ base, manifest }) => (manifest.catalogs ?? []).filter(canBrowse).map((entry) => ({
    base, manifest, entry, id: `${addonOriginId(base)}:${entry.type}:${entry.id}`,
  })))
}

function stremioHomeOptions(entries: StremioHomeEntry[]): CatalogHomeRowOption[] {
  return [CONTINUE_HOME_ROW, ...entries.map(({ manifest, entry, id }) => ({
    id,
    title: entries.length > 1 ? `${entry.name} · ${manifest.name}` : entry.name,
    description: `${entry.type} catalog supplied by ${manifest.name}.`,
    group: manifest.name,
    defaultEnabled: true,
  }))]
}

async function homeRows(): Promise<CatalogHomeRowOption[]> {
  return stremioHomeOptions(stremioHomeEntries(await manifests()))
}

async function home(signal?: AbortSignal): Promise<CatalogHome> {
  const sources = await manifests()
  const available = stremioHomeEntries(sources)
  const byId = new Map(available.map((entry) => [entry.id, entry]))
  // Keep the provider safety cap, but apply it after customization so a user can promote a row
  // from a large add-on manifest by hiding or moving less useful catalogs.
  const entries = resolveCatalogHomeRows('stremio', stremioHomeOptions(available), get(catalogHomeLayouts))
    .filter((row) => row.enabled && row.id !== 'continue').flatMap((row) => byId.get(row.id) ?? []).slice(0, 16)
  const rows = await Promise.all(entries.map(async ({ base, manifest, entry, id }) => ({
    id,
    title: available.length > 1 ? `${entry.name} · ${manifest.name}` : entry.name,
    media: await catalog(base, entry, {}, signal).catch(() => []),
    more: canSearch(entry) ? { type: contentType(entry.type) } : undefined,
  })))
  const sections = rows.filter((row) => row.media.length)
  const all = sections.flatMap((section) => section.media)
  const hero = all.filter((media) => media.bannerImage)
  return { hero: (hero.length ? hero : all).slice(0, 10), sections }
}

async function search(request: CatalogSearchRequest): Promise<CatalogPage> {
  const sources = await manifests()
  const entries = sources.flatMap(({ base, manifest }) => (manifest.catalogs ?? [])
    .filter((entry) => canSearch(entry)
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
  return { media, page: request.page ?? 1, hasNextPage: pages.some((page) => page.length >= 100) }
}

async function detail(ref: MediaRef, signal?: AbortSignal): Promise<Media | null> {
  if (ref.provider !== 'stremio') return null
  const decoded = decodeStremioIdentity(ref.id)
  if (!decoded) return null
  const base = get(enabledAddonUrls).map(normalizeBase).find((url) => addonOriginId(url) === decoded.addonId)
  if (!base) throw new CatalogConfigurationError('The Stremio metadata add-on that supplied this item is no longer enabled.')
  const response = await getJson<{ meta?: StremioMeta }>(
    stremioMetaUrl(base, decoded.type, decoded.id), signal,
  )
  return response.meta ? mapMeta(response.meta, base, decoded.type) : null
}

export const stremioCatalog: CatalogProvider = {
  id: 'stremio',
  label: 'Stremio metadata',
  capabilities: {
    anime: true, movies: true, series: true, search: true, genres: true,
    episodes: true, cast: true, relations: false,
  },
  homeRows,
  home,
  search,
  detail,
}
