// @ts-nocheck -- Wrangler validates this Worker module; the root app checker cannot model its
// cross-package TypeScript import without changing the browser application's compiler contract.
import { searchSubtitleServices } from './subtitle-services.js'
import { normalizeHousehold } from './profiles.js'
import { createTvSourceLookup, tvSourceRequests, verifyTvSourceLookup } from './tv-source-lookup.js'
import {
  acceptsStreamId,
  addonOriginId,
  applyPriorityFilter,
  buildStreamIds,
  dedupeStreams,
  describe,
  isNotice,
  isSupplementalVideo,
  isTvVideoCompatible,
  normalizeStreamBehavior,
  pickCandidates,
  refineStreamsLite,
} from './generated/resolver-core/resolver-core.ts'
import {
  cacheCheckMode,
  checkCached,
  providerName,
  providers,
  resolveHash as resolveDebridHash,
  resolveSidecars as resolveDebridSidecars,
} from './generated/resolver-core/debrid/index.ts'
import { rdForgetLists } from './generated/resolver-core/debrid/providers/realdebrid.ts'
import { catalogInternals, catalogSearch, catalogSnapshot, decodeStremioRef } from './catalog.js'

const MAX_ADDONS = 16
const MAX_ADDON_URL_BYTES = 2048
const MAX_STREAM_IDS = 6
const MAX_STREAMS_PER_ADDON = 80
const MAX_RESPONSE_CANDIDATES = 12
// Sized for real indexer stream responses: an unlimited-results configuration measures well over
// 2 MiB for a popular film, and the old 512 KiB cap silently dropped that whole source (and every
// release it carried) from every TV lookup.
const MAX_PROVIDER_RESPONSE_BYTES = 4 * 1024 * 1024
const METADATA_TIMEOUT_MS = 5_000
const MANIFEST_TIMEOUT_MS = 4_000
const STREAM_TIMEOUT_MS = 12_000
const QUALITY = new Set(['any', '2160', '1440', '1080', '720', '480', '360'])
const SORT = new Set(['quality', 'seeders', 'size'])
const PROVIDERS = new Set(['anilist', 'kitsu', 'tmdb', 'stremio'])
const TYPES = new Set(['anime', 'movie', 'series'])
const CATALOG_SCREENS = new Set(['auto', 'anilist', 'kitsu', 'tmdb', 'stremio', 'merged', 'jvm'])
const encoder = new TextEncoder()

const DEFAULT_PROFILE = Object.freeze({
  enabled: false,
  addons: [],
  quality: 'any',
  sort: 'quality',
  audioLang: '',
  connectedDeviceFallback: false,
  allowPrivateNetworkSources: false,
  debrid: null,
  catalog: {
    screens: ['auto'],
    defaultScreen: 'auto',
    showAdult: false,
    hideSpoilers: false,
    tmdbToken: '',
  },
})

function publicHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false
  if (host.includes(':')) return false // IP literals are unnecessary for self-hosted add-on URLs.
  const octets = host.split('.').map(Number)
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b] = octets
  return !(a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168))
}

export function normalizeAddonBase(value, workerOrigin = '') {
  if (typeof value !== 'string' || !value.trim() || encoder.encode(value).byteLength > MAX_ADDON_URL_BYTES) {
    throw new Error('Each resolver add-on must be a valid HTTPS URL.')
  }
  let url
  try { url = new URL(value.trim().replace(/^stremio:\/\//i, 'https://')) } catch {
    throw new Error('Each resolver add-on must be a valid HTTPS URL.')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || !publicHostname(url.hostname)) {
    throw new Error('Resolver add-ons must use a public HTTPS URL without embedded browser credentials.')
  }
  if (workerOrigin && url.origin === workerOrigin) throw new Error('The resolver cannot use itself as a stream add-on.')
  url.pathname = url.pathname.replace(/\/manifest\.json\/?$/i, '').replace(/\/$/, '')
  return url.toString().replace(/\/$/, '')
}

function normalizeSubtitleStyle(style) {
  const bounded = (value, min, max) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : undefined
  const color = value => /^#[0-9a-f]{6}$/i.test(value ?? '') ? value : undefined
  return { enabled: style.enabled === true, scope: style.scope === 'all' ? 'all' : 'dialogue',
    font: cleanText(style.font, 80), bold: style.bold === true, fontSize: bounded(style.fontSize, 18, 100),
    textColor: color(style.textColor), borderColor: color(style.borderColor), borderSize: bounded(style.borderSize, 0, 8),
    shadow: bounded(style.shadow, 0, 8), position: bounded(style.position, 0, 100) }
}

export function normalizeResolverProfile(value, workerOrigin = '') {
  if (!value || typeof value !== 'object') throw new Error('Resolver profile must be a JSON object.')
  const input = value
  if (!Array.isArray(input.addons)) throw new Error('Resolver add-ons must be a list of URLs.')
  // One malformed/private entry (or an over-long list) must not reject the whole profile save:
  // that silently freezes EVERY later settings change out of the TV until the entry is removed.
  // Keep the valid sources and drop only the entries this Worker could never query.
  const addons = [...new Set(input.addons.flatMap((entry) => {
    try { return [normalizeAddonBase(entry, workerOrigin)] } catch { return [] }
  }))].slice(0, MAX_ADDONS)
  const quality = QUALITY.has(String(input.quality)) ? String(input.quality) : 'any'
  const sort = SORT.has(String(input.sort)) ? String(input.sort) : 'quality'
  // The desktop's source trust order, as the same opaque origin ids it stores locally. Strict mode
  // must exclude unlisted sources on the TV exactly as it does in the desktop picker.
  const sourcePriority = Array.isArray(input.sourcePriority)
    ? [...new Set(input.sourcePriority.flatMap((entry) => typeof entry === 'string' && /^[a-f0-9]{16}$/.test(entry) ? [entry] : []))].slice(0, 32)
    : []
  const sourcePriorityMode = input.sourcePriorityMode === 'strict' ? 'strict' : 'prefer'
  const audioLang = typeof input.audioLang === 'string' && /^[a-z]{2,3}$/i.test(input.audioLang.trim())
    ? input.audioLang.trim().toLowerCase().slice(0, 3)
    : ''
  let debrid = null
  if (input.debrid != null) {
    const provider = typeof input.debrid?.provider === 'string' ? input.debrid.provider.trim().toLowerCase() : ''
    if (!providers.has(provider)) {
      throw new Error('This Cloudflare resolver does not recognise the configured debrid provider.')
    }
    const rawCredential = input.debrid.credential ?? input.debrid.token
    const credential = typeof rawCredential === 'string' ? rawCredential.trim() : ''
    if (credential.length < 3 || credential.length > 1_024 || /[\u0000-\u001f\u007f]/.test(credential)) {
      throw new Error(`The ${providerName(provider)} credential is invalid.`)
    }
    debrid = { provider, credential }
  }
  const catalogValue = input.catalog && typeof input.catalog === 'object' ? input.catalog : {}
  const suppliedScreens = Array.isArray(catalogValue.screens) ? catalogValue.screens : ['auto']
  const screens = [...new Set(suppliedScreens.flatMap((entry) => CATALOG_SCREENS.has(String(entry)) ? [String(entry)] : []))]
  if (!screens.length) screens.push('auto')
  const defaultScreen = screens.includes(String(catalogValue.defaultScreen))
    ? String(catalogValue.defaultScreen)
    : screens.find((entry) => entry !== 'jvm') ?? 'auto'
  const tmdbToken = typeof catalogValue.tmdbToken === 'string' ? catalogValue.tmdbToken.trim() : ''
  if (tmdbToken.length > 2_048 || /[\u0000-\u001f\u007f]/.test(tmdbToken)) throw new Error('The TMDB catalogue credential is invalid.')
  return {
    enabled: input.enabled === true,
    ...(Array.isArray(input.collections) ? { collections: input.collections } : {}),
    ...(input.household ? { household: normalizeHousehold(input.household) } : {}),
    addons,
    ...(Array.isArray(input.subtitleServices) ? { subtitleServices: input.subtitleServices.slice(0, 3).map(service => {
      if (service?.kind !== 'rest-v1') throw new Error('Invalid subtitle service.')
      const base = normalizeAddonBase(service.base, workerOrigin)
      const apiKey = cleanText(service.apiKey, 512)
      if (!apiKey || /[\r\n]/.test(apiKey)) throw new Error('Invalid subtitle service credential.')
      const token = cleanText(service.token, 4096)
      return { kind: 'rest-v1', base, apiKey, ...(token && !/[\r\n]/.test(token) && Number.isFinite(service.expires) ? { token, expires: service.expires } : {}) }
    }) } : {}),
    ...(typeof input.subtitleLang === 'string' ? { subtitleLang: input.subtitleLang.slice(0, 16) } : {}),
    ...(input.subtitleStyle && typeof input.subtitleStyle === 'object' ? { subtitleStyle: normalizeSubtitleStyle(input.subtitleStyle) } : {}),
    quality,
    sort,
    audioLang,
    ...(sourcePriority.length ? { sourcePriority } : {}),
    ...(sourcePriorityMode !== 'prefer' ? { sourcePriorityMode } : {}),
    connectedDeviceFallback: input.connectedDeviceFallback === true,
    allowPrivateNetworkSources: input.allowPrivateNetworkSources === true,
    debrid,
    catalog: {
      screens,
      defaultScreen,
      showAdult: catalogValue.showAdult === true,
      hideSpoilers: catalogValue.hideSpoilers === true,
      tmdbToken,
    },
  }
}

/** Owner devices may inspect resolver settings, but credentials never need to be echoed back. */
export function publicResolverProfile(profileValue, workerOrigin = '') {
  const profile = normalizeResolverProfile(profileValue, workerOrigin)
  return {
    ...profile,
    ...(profile.subtitleServices ? { subtitleServices: profile.subtitleServices.map(service => ({ kind: service.kind, configured: true })) } : {}),
    debrid: profile.debrid
      ? { provider: profile.debrid.provider, configured: true }
      : null,
    catalog: {
      ...profile.catalog,
      tmdbToken: undefined,
      tmdbConfigured: !!profile.catalog.tmdbToken,
    },
  }
}

export function normalizeResolveRequest(value) {
  if (!value || typeof value !== 'object' || !value.ref || typeof value.ref !== 'object') {
    throw new Error('A media reference is required.')
  }
  const input = value
  const provider = String(input.ref.provider || '')
  const type = String(input.ref.type || '')
  const id = typeof input.ref.id === 'string' ? input.ref.id.trim() : ''
  if (!PROVIDERS.has(provider) || !TYPES.has(type) || !id || id.length > 512 || /[\u0000-\u001f]/.test(id)) {
    throw new Error('This media reference cannot be resolved in the Worker.')
  }
  const positiveInt = (entry, maximum) => {
    const number = Number(entry)
    return Number.isInteger(number) && number > 0 && number <= maximum ? number : undefined
  }
  const episode = positiveInt(input.episode, 100_000)
  const season = input.season === 0 ? 0 : positiveInt(input.season, 1_000)
  const streamType = input.streamType === 'movie' || input.streamType === 'series'
    ? input.streamType
    : type === 'movie' ? 'movie' : 'series'
  const supplied = Array.isArray(input.streamIds) ? input.streamIds : []
  if (supplied.length > MAX_STREAM_IDS) throw new Error(`No more than ${MAX_STREAM_IDS} stream identifiers may be supplied.`)
  const streamIds = [...new Set(supplied.flatMap((entry) => {
    if (typeof entry !== 'string') return []
    const clean = entry.trim()
    return clean && clean.length <= 512 && !/[\u0000-\u001f]/.test(clean) ? [clean] : []
  }))]
  const nativeType = provider === 'stremio'
    && typeof input.nativeType === 'string'
    && /^[A-Za-z0-9._-]{1,80}$/.test(input.nativeType)
    ? input.nativeType
    : undefined
  const title = cleanText(input.title, 240)
  const excludeCandidateIds = Array.isArray(input.excludeCandidateIds) ? [...new Set(input.excludeCandidateIds
    .filter(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(id)))].slice(0, 60) : []
  const videoCapabilities = input.videoCapabilities && typeof input.videoCapabilities === 'object'
    ? Object.fromEntries(['hdr', 'uhd', 'av1'].flatMap(key => typeof input.videoCapabilities[key] === 'boolean' ? [[key, input.videoCapabilities[key]]] : [])) : undefined
  return { ref: { provider, type, id }, episode, season, streamType, nativeType, streamIds,
    ...(title ? { title } : {}), ...(excludeCandidateIds.length ? { excludeCandidateIds } : {}), ...(videoCapabilities ? { videoCapabilities } : {}) }
}

function addonEndpoint(base, suffix) {
  const url = new URL(base)
  const search = url.search
  url.search = ''
  url.pathname = `${url.pathname.replace(/\/$/, '')}${suffix}`
  url.search = search
  return url.toString()
}

async function fetchJson(fetcher, url, timeoutMs, onFailure = () => {}) {
  if (timeoutMs <= 0) { onFailure('could not be reached within the cloud lookup time limit.'); return null }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Izumi-Cloud-Resolver/1' },
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!response.ok) {
      onFailure(response.status === 403
        ? 'could not be reached from the cloud (HTTP 403).'
        : `returned HTTP ${response.status}.`)
      await response.body?.cancel()
      return null
    }
    const announced = Number(response.headers.get('content-length') || 0)
    if (announced > MAX_PROVIDER_RESPONSE_BYTES) {
      onFailure('returned a response larger than the cloud source limit.')
      await response.body?.cancel()
      return null
    }
    const text = await response.text()
    if (encoder.encode(text).byteLength > MAX_PROVIDER_RESPONSE_BYTES) {
      onFailure('returned a response larger than the cloud source limit.')
      return null
    }
    return JSON.parse(text)
  } catch {
    onFailure(controller.signal.aborted ? 'timed out responding to the Worker.' : 'could not return a valid response to the Worker.')
    return null
  } finally { clearTimeout(timer) }
}

async function metadataFor(request, fetcher) {
  if (request.ref.provider !== 'anilist') return null
  if (!/^\d{1,10}$/.test(request.ref.id)) return null
  return fetchJson(fetcher, `https://api.ani.zip/mappings?anilist_id=${encodeURIComponent(request.ref.id)}`, METADATA_TIMEOUT_MS)
}

function detailEnvelope(episodes, extra = {}) {
  const cleanEpisodes = episodes.filter((entry) => Number.isInteger(entry.season) && entry.season >= 0
    && Number.isInteger(entry.episode) && entry.episode > 0).slice(0, 2_000)
  const seasons = new Map()
  for (const entry of cleanEpisodes) seasons.set(entry.season, Math.max(seasons.get(entry.season) ?? 0, entry.episode))
  const ordered = [...seasons.entries()].sort(([left], [right]) => left - right)
  return {
    ...extra,
    episodes: cleanEpisodes,
    seasonEpisodeCounts: ordered.map(([, count]) => count),
    seasonLabels: ordered.map(([season]) => season === 0 ? 'Specials' : `Season ${season}`),
  }
}

async function kitsuDetails(request) {
  if (!/^\d{1,12}$/.test(request.ref.id)) return null
  const detail = await catalogInternals.fetchJson(`https://kitsu.io/api/edge/anime/${encodeURIComponent(request.ref.id)}`)
  const attrs = detail?.data?.attributes ?? {}
  const episodes = []
  let next = `https://kitsu.io/api/edge/episodes?filter%5BmediaId%5D=${encodeURIComponent(request.ref.id)}&sort=number&page%5Blimit%5D=20`
  for (let page = 0; next && page < 25; page++) {
    const value = await catalogInternals.fetchJson(next)
    for (const raw of value?.data ?? []) {
      const episode = Number(raw?.attributes?.number)
      if (!Number.isInteger(episode) || episode < 1) continue
      episodes.push({
        season: 1, episode,
        title: cleanText(raw.attributes?.canonicalTitle, 300),
        description: cleanText(raw.attributes?.synopsis, 1_500),
        image: cleanUrl(raw.attributes?.thumbnail?.original ?? raw.attributes?.thumbnail?.large),
        runtimeMinutes: Number(raw.attributes?.length) || Number(attrs.episodeLength) || undefined,
        releasedAt: cleanText(raw.attributes?.airdate, 40),
      })
    }
    next = typeof value?.links?.next === 'string' ? value.links.next : ''
  }
  const summary = catalogInternals.kitsuMedia(detail?.data)
  return detailEnvelope(episodes, summary ? {
    isAdult: summary.isAdult, contentRating: summary.contentRating,
    description: summary.description, poster: summary.poster, backdrop: summary.backdrop,
    runtimeMinutes: summary.runtimeMinutes, ratings: summary.ratings,
  } : {})
}

async function tmdbDetails(request, profile) {
  if (!/^\d{1,12}$/.test(request.ref.id) || !profile.catalog.tmdbToken) return null
  const kind = request.ref.type === 'movie' ? 'movie' : 'tv'
  const detail = await catalogInternals.tmdbRequest(profile.catalog.tmdbToken, `/${kind}/${encodeURIComponent(request.ref.id)}`, {
    append_to_response: 'videos,images,release_dates,content_ratings,recommendations,credits,aggregate_credits,external_ids',
    include_image_language: 'en,null',
  })
  const summary = catalogInternals.tmdbMedia({ ...detail, media_type: kind })
  const trailers = detail?.videos?.results ?? []
  const trailer = trailers.find((entry) => entry?.site === 'YouTube' && entry?.type === 'Trailer' && entry?.official)
    ?? trailers.find((entry) => entry?.site === 'YouTube')
  const seasons = kind === 'tv' ? (detail?.seasons ?? []).filter((entry) => Number.isInteger(entry?.season_number)).slice(0, 20) : []
  const settled = await Promise.allSettled(seasons.map((season) => catalogInternals.tmdbRequest(
    profile.catalog.tmdbToken, `/tv/${encodeURIComponent(request.ref.id)}/season/${season.season_number}`,
  )))
  const episodes = kind === 'movie' ? [] : settled
    .filter((entry) => entry.status === 'fulfilled')
    .flatMap((entry) => (entry.value?.episodes ?? []).flatMap((raw) => (
      Number.isInteger(raw?.episode_number) && Number.isInteger(raw?.season_number) ? [{
        season: raw.season_number,
        episode: raw.episode_number,
        title: cleanText(raw.name, 300),
        description: cleanText(raw.overview, 1_500),
        image: raw.still_path ? `https://image.tmdb.org/t/p/w780${raw.still_path}` : undefined,
        runtimeMinutes: Number(raw.runtime) || undefined,
        releasedAt: cleanText(raw.air_date, 40),
      }] : []
    )))
  const credits = detail?.aggregate_credits ?? detail?.credits ?? {}
  const cast = (credits.cast ?? []).slice(0, 20).flatMap((entry) => entry?.id && entry?.name ? [{
    id: String(entry.id), provider: 'tmdb', name: cleanText(entry.name, 160),
    role: cleanText(entry.character ?? entry.roles?.[0]?.character, 160),
    image: entry.profile_path ? `https://image.tmdb.org/t/p/w185${entry.profile_path}` : undefined, credit: 'cast',
  }] : [])
  const crew = (credits.crew ?? []).slice(0, 20).flatMap((entry) => entry?.id && entry?.name ? [{
    id: String(entry.id), provider: 'tmdb', name: cleanText(entry.name, 160),
    role: cleanText(entry.job ?? entry.jobs?.[0]?.job, 160),
    image: entry.profile_path ? `https://image.tmdb.org/t/p/w185${entry.profile_path}` : undefined, credit: 'crew',
  }] : [])
  return detailEnvelope(episodes, {
    isAdult: summary?.isAdult, contentRating: summary?.contentRating,
    description: summary?.description,
    poster: summary?.poster,
    backdrop: summary?.backdrop,
    runtimeMinutes: Number(detail?.runtime) || Number(detail?.episode_run_time?.[0]) || undefined,
    genres: (detail?.genres ?? []).map((entry) => cleanText(entry?.name, 80)).filter(Boolean),
    ratings: summary?.ratings,
    trailer: trailer?.key ? { id: String(trailer.key).slice(0, 40), site: 'youtube' } : undefined,
    cast, crew,
  })
}

async function stremioDetails(request, profile) {
  const identity = decodeStremioRef(request.ref.id)
  if (!identity) return null
  const bases = profile.addons.map(catalogInternals.normalizeBase)
  const preferred = bases.find((candidate) => catalogInternals.fnv(candidate) === identity.addonId)
  // Account libraries carry a global IMDb/TMDB id, but the first enabled source may supply streams only.
  const candidates = [...new Set([preferred, ...(/^(?:tt\d+|tmdb:\d+)$/.test(identity.id) ? bases : [])].filter(Boolean))]
  let base = preferred
  let raw = null
  for (const candidate of candidates) {
   try {
    const url = new URL(candidate)
    const search = url.search
    url.search = ''
    url.pathname = `${url.pathname.replace(/\/$/, '')}/meta/${encodeURIComponent(identity.type)}/${encodeURIComponent(identity.id)}.json`
    url.search = search
    raw = (await catalogInternals.fetchJson(url.toString()))?.meta
    if (raw) { base = candidate; break }
   } catch { /* Try the next installed metadata source for a known global id. */ }
  }
  if (!raw) return null
  const summary = catalogInternals.stremioMedia(raw, base, identity.type)
  const episodes = (raw.videos ?? []).flatMap((entry, index) => {
    const episode = Number(entry?.episode ?? index + 1)
    const season = Number(entry?.season ?? 1)
    return Number.isInteger(episode) && episode > 0 && Number.isInteger(season) && season >= 0 ? [{
      season, episode,
      videoId: cleanText(entry.id, 512),
      title: cleanText(entry.title, 300), description: cleanText(entry.overview, 1_500),
      image: cleanUrl(entry.thumbnail), releasedAt: cleanText(entry.released, 40),
    }] : []
  })
  return detailEnvelope(episodes, summary ? {
    isAdult: summary.isAdult, contentRating: summary.contentRating,
    description: summary.description, poster: summary.poster, backdrop: summary.backdrop,
    logoImage: summary.logoImage, runtimeMinutes: summary.runtimeMinutes, genres: summary.genres,
    ratings: summary.ratings, trailer: summary.trailer,
  } : {})
}

/** Resolve the public, non-secret episode library used by the TV series screen. Playback sources
 * stay in the resolver profile; this endpoint only returns titles, summaries and artwork. */
export async function resolveMediaDetails(value, profileOrFetcher = defaultResolverProfile(), maybeFetcher = fetch) {
  const fetcher = typeof profileOrFetcher === 'function' ? profileOrFetcher : maybeFetcher
  const profile = typeof profileOrFetcher === 'function' ? defaultResolverProfile() : normalizeResolverProfile(profileOrFetcher)
  const request = normalizeResolveRequest(value)
  if (request.ref.provider === 'kitsu') return kitsuDetails(request)
  if (request.ref.provider === 'tmdb') return tmdbDetails(request, profile)
  if (request.ref.provider === 'stremio') return stremioDetails(request, profile)
  if (request.ref.provider !== 'anilist') return null
  const [metadata, catalogue] = await Promise.all([
    metadataFor(request, fetcher),
    catalogInternals.aniDetail(request.ref.id, fetcher).catch(() => null),
  ])
  const entries = Object.entries(metadata?.episodes ?? {})
    .flatMap(([key, raw]) => {
      const absolute = Number(key)
      if (!Number.isInteger(absolute) || absolute < 1 || !raw || typeof raw !== 'object') return []
      const season = Number.isInteger(raw.seasonNumber) && raw.seasonNumber >= 0 ? raw.seasonNumber : 1
      const episode = Number.isInteger(raw.episodeNumber) && raw.episodeNumber > 0 ? raw.episodeNumber : absolute
      const localizedTitle = raw.title && typeof raw.title === 'object'
        ? raw.title.en ?? raw.title['x-jat']
        : undefined
      const runtime = Number(raw.runtime ?? raw.length)
      return [{
        absolute,
        season,
        episode,
        title: cleanText(localizedTitle, 300)?.replace(/`/g, '’'),
        description: cleanText(raw.overview ?? raw.summary, 1_500),
        image: cleanUrl(raw.image),
        runtimeMinutes: Number.isFinite(runtime) && runtime > 0 ? Math.max(1, Math.round(runtime)) : undefined,
      }]
    })
    .sort((left, right) => left.absolute - right.absolute)
  if (!entries.length && !catalogue) return null
  const summary = catalogue?.summary
  return detailEnvelope(entries.map(({ absolute: _absolute, ...episode }) => episode), summary ? {
    isAdult: summary.isAdult, contentRating: summary.contentRating,
    description: summary.description,
    poster: summary.poster,
    backdrop: summary.backdrop,
    runtimeMinutes: summary.runtimeMinutes,
    genres: summary.genres,
    ratings: summary.ratings,
    trailer: summary.trailer,
    cast: catalogue.cast,
    crew: catalogue.crew,
    relations: catalogue.relations,
    recommendations: catalogue.recommendations,
  } : {})
}

export async function streamRequestPlan(request, fetcher = fetch, profile = defaultResolverProfile()) {
  if (request.streamIds.length) {
    const identity = request.ref.provider === 'stremio' ? decodeStremioRef(request.ref.id) : null
    let ids = request.streamIds
    const titleIds = ids.filter(id => /^(?:tt\d+|tmdb:\d+)$/.test(id))
    if (request.streamType === 'movie' && titleIds.length) ids = titleIds
    // Catalogue hints are not necessarily IDs accepted by stream sources. Enrich them before
    // deciding that the cloud or TV has nothing to query, retaining exact episode coordinates.
    if (profile.catalog?.tmdbToken && ids.every((id) => /^tmdb:\d+(?::\d+:\d+)?$/.test(id))) {
      const mapped = await mapLimit(ids, 2, async (id) => {
        const [, title, season, episode] = id.split(':')
        const kind = request.streamType === 'movie' ? 'movie' : 'tv'
        const external = await catalogInternals.tmdbRequest(profile.catalog.tmdbToken,
          `/${kind}/${title}/external_ids`, {}, fetcher).catch(() => null)
        if (!/^tt\d+$/.test(external?.imdb_id ?? '')) return []
        return [external.imdb_id + (episode != null ? `:${season}:${episode}` : '')]
      })
      ids = [...new Set([...mapped.flat(), ...ids])].slice(0, MAX_STREAM_IDS)
    }
    return {
      ids,
      want: request.episode ? { episode: request.episode, season: request.season } : undefined,
      addonId: identity?.addonId,
    }
  }
  if (request.ref.provider === 'stremio') {
    const identity = decodeStremioRef(request.ref.id)
    return identity
      ? { ids: [identity.id], want: undefined, addonId: identity.addonId }
      : { ids: [], want: undefined }
  }
  if (request.ref.provider === 'kitsu') {
    const kitsu = Number(request.ref.id)
    return Number.isInteger(kitsu) && kitsu > 0
      ? { ids: buildStreamIds({ type: request.streamType, kitsu, episode: request.episode }), want: request.episode ? { episode: request.episode, season: request.season } : undefined }
      : { ids: [], want: undefined }
  }
  if (request.ref.provider === 'tmdb') {
    const kind = request.ref.type === 'movie' ? 'movie' : 'tv'
    const external = profile.catalog?.tmdbToken
      ? await catalogInternals.tmdbRequest(
        profile.catalog.tmdbToken,
        `/${kind}/${encodeURIComponent(request.ref.id)}/external_ids`,
        {},
        fetcher,
      ).catch(() => null)
      : null
    return {
      ids: buildStreamIds({
        type: request.streamType,
        imdb: typeof external?.imdb_id === 'string' ? external.imdb_id : undefined,
        tmdb: request.ref.id,
        episode: request.episode,
        season: request.season,
        imdbEpisode: request.episode,
      }),
      want: request.episode ? { episode: request.episode, season: request.season } : undefined,
    }
  }
  const metadata = await metadataFor(request, fetcher)
  const mappings = metadata?.mappings ?? {}
  const episode = request.episode != null ? metadata?.episodes?.[String(request.episode)] : undefined
  const ids = buildStreamIds({
    type: request.streamType,
    kitsu: Number(mappings.kitsu_id) || undefined,
    episode: request.episode,
    imdb: typeof mappings.imdb_id === 'string' ? mappings.imdb_id : undefined,
    tmdb: typeof mappings.themoviedb_id === 'string' || typeof mappings.themoviedb_id === 'number'
      ? mappings.themoviedb_id
      : undefined,
    season: Number.isInteger(episode?.seasonNumber) ? episode.seasonNumber : request.season,
    imdbEpisode: Number.isInteger(episode?.episodeNumber) ? episode.episodeNumber : undefined,
  })
  const want = request.episode == null ? undefined : {
    episode: request.episode,
    season: Number.isInteger(episode?.seasonNumber) ? episode.seasonNumber : request.season,
    abs: Number.isInteger(episode?.absoluteEpisodeNumber) ? episode.absoluteEpisodeNumber : undefined,
  }
  return { ids, want, malId: Number(mappings.mal_id) || undefined, refine: aniZipRefineHints(metadata, episode) }
}

/** Title/shape evidence for refineStreamsLite, from the mapping response the plan already fetched. */
function aniZipRefineHints(metadata, episode) {
  const titles = Object.values(metadata?.titles ?? {})
    .flatMap((value) => typeof value === 'string' && value.trim() ? [value.trim()] : []).slice(0, 8)
  const totalEpisodes = Object.keys(metadata?.episodes ?? {}).filter((key) => /^\d+$/.test(key)).length
  const runtime = Number(episode?.runtime ?? episode?.length)
  return {
    titles,
    ...(totalEpisodes ? { totalEpisodes } : {}),
    ...(Number.isFinite(runtime) && runtime > 0 ? { expectedSeconds: Math.round(runtime * 60) } : {}),
    ...(totalEpisodes > 60 ? { absoluteNumbered: true } : {}),
  }
}

/**
 * Build the refinement context the desktop derives from its AniList `Media`. The Worker only has
 * the media reference, so each provider contributes what its own catalogue can answer within the
 * metadata deadline; every field is optional and refineStreamsLite treats absence as "keep".
 */
async function refineContextFor(request, plan, profile, fetcher) {
  const titles = []
  let year
  let releasedAt
  let expectedSeconds = plan.refine?.expectedSeconds
  let totalEpisodes = plan.refine?.totalEpisodes
  let absoluteNumbered = plan.refine?.absoluteNumbered
  if (request.title) {
    titles.push(request.title)
    // Catalogue rows occasionally carry a "(2026)" disambiguation suffix; releases never do.
    const disambiguated = request.title.match(/^(.*?)\s*\(((?:19|20)\d{2})\)\s*$/)
    if (disambiguated?.[1]) {
      titles.push(disambiguated[1])
      year = Number(disambiguated[2])
    }
  }
  titles.push(...(plan.refine?.titles ?? []))
  if (request.ref.provider === 'kitsu' && /^\d{1,12}$/.test(request.ref.id)) {
    const detail = await fetchJson(fetcher, `https://kitsu.io/api/edge/anime/${encodeURIComponent(request.ref.id)}`, METADATA_TIMEOUT_MS)
    const attrs = detail?.data?.attributes
    if (attrs) {
      titles.push(...[attrs.canonicalTitle, ...Object.values(attrs.titles ?? {}), ...(Array.isArray(attrs.abbreviatedTitles) ? attrs.abbreviatedTitles : [])]
        .flatMap((value) => typeof value === 'string' && value.trim() ? [value.trim()] : []))
      const count = Number(attrs.episodeCount)
      if (Number.isInteger(count) && count > 0) {
        totalEpisodes = count
        absoluteNumbered = absoluteNumbered ?? count > 60
      }
      const debut = Number(String(attrs.startDate ?? '').slice(0, 4))
      if (debut >= 1950 && debut <= 2035) year = debut
      const minutes = Number(attrs.episodeLength)
      if (!expectedSeconds && Number.isFinite(minutes) && minutes > 0) expectedSeconds = Math.round(minutes * 60)
    }
  }
  if (request.ref.provider === 'stremio') {
    // Global title ids carry no year/date evidence by themselves. Ask the user's OWN configured
    // add-ons for the meta object — the add-on that owns the catalogue row first, then any other
    // configured source. Never a hardcoded metadata endpoint: which catalogue answers is entirely
    // the user's configuration.
    const globalId = [request.ref.id, ...(plan.ids ?? [])].find((id) => /^tt\d+$/.test(String(id ?? '')))
    if (globalId) {
      // Most configured add-ons are stream indexers that 404 the meta resource, so probe every
      // configured source in parallel and keep the first answer in configuration order — with the
      // add-on that owns the catalogue row moved to the front.
      const owning = profile.addons.filter((base) => plan.addonId
        && catalogInternals.fnv(catalogInternals.normalizeBase(base)) === plan.addonId)
      const bases = [...new Set([...owning, ...profile.addons])]
      const kind = request.streamType === 'movie' ? 'movie' : 'series'
      const answers = await mapLimit(bases, 3, (base) => fetchJson(fetcher,
        addonEndpoint(base, `/meta/${kind}/${encodeURIComponent(globalId)}.json`), METADATA_TIMEOUT_MS))
      const meta = answers.find((value) => value?.meta)?.meta
      if (meta) {
        titles.push(...[meta.name, meta.originalName].flatMap((entry) => typeof entry === 'string' && entry.trim() ? [entry.trim()] : []))
        const debut = Number(String(meta.year ?? '').slice(0, 4))
        if (debut >= 1950 && debut <= 2035) year = debut
        const premiered = Date.parse(String(meta.released ?? ''))
        if (Number.isFinite(premiered)) releasedAt = premiered
        const minutes = Number(String(meta.runtime ?? '').match(/\d+/)?.[0])
        if (!expectedSeconds && Number.isFinite(minutes) && minutes > 0) expectedSeconds = Math.round(minutes * 60)
      }
    }
  }
  if (request.ref.provider === 'tmdb' && profile.catalog?.tmdbToken && /^\d{1,12}$/.test(request.ref.id)) {
    const kind = request.ref.type === 'movie' ? 'movie' : 'tv'
    const detail = await catalogInternals.tmdbRequest(profile.catalog.tmdbToken,
      `/${kind}/${encodeURIComponent(request.ref.id)}`, {}, fetcher).catch(() => null)
    if (detail) {
      titles.push(...[detail.title, detail.name, detail.original_title, detail.original_name]
        .flatMap((value) => typeof value === 'string' && value.trim() ? [value.trim()] : []))
      const debut = Number(String(detail.release_date ?? detail.first_air_date ?? '').slice(0, 4))
      if (debut >= 1950 && debut <= 2035) year = debut
      const premiered = Date.parse(String(detail.release_date ?? ''))
      if (Number.isFinite(premiered)) releasedAt = premiered
      const minutes = Number(kind === 'movie' ? detail.runtime : detail.episode_run_time?.[0])
      if (!expectedSeconds && Number.isFinite(minutes) && minutes > 0) expectedSeconds = Math.round(minutes * 60)
      const count = Number(detail.number_of_episodes)
      if (!totalEpisodes && Number.isInteger(count) && count > 0) totalEpisodes = count
    }
  }
  return {
    titles: [...new Set(titles)].slice(0, 12),
    streamType: request.streamType,
    ...(year ? { year } : {}),
    ...(releasedAt ? { releasedAt } : {}),
    ...(expectedSeconds ? { expectedSeconds } : {}),
    ...(totalEpisodes ? { totalEpisodes } : {}),
    ...(absoluteNumbered ? { absoluteNumbered: true } : {}),
  }
}

async function resolveSkipSegments(plan, request, fetcher) {
  if (!plan?.malId || !request.episode) return []
  const types = ['op', 'ed', 'recap', 'mixed-op', 'mixed-ed']
    .map((type) => `types=${encodeURIComponent(type)}`).join('&')
  const value = await fetchJson(fetcher,
    `https://api.aniskip.com/v2/skip-times/${plan.malId}/${request.episode}/?episodeLength=0&${types}`,
    METADATA_TIMEOUT_MS)
  if (!value?.found || !Array.isArray(value.results)) return []
  const labels = { op: 'Opening', 'mixed-op': 'Opening', ed: 'Ending', 'mixed-ed': 'Ending', recap: 'Recap' }
  return value.results.slice(0, 16).flatMap((entry) => {
    const type = typeof entry?.skipType === 'string' && labels[entry.skipType] ? entry.skipType : ''
    const startTime = Number(entry?.interval?.startTime)
    const endTime = Number(entry?.interval?.endTime)
    if (!type || !Number.isFinite(startTime) || !Number.isFinite(endTime)
      || startTime < 0 || endTime <= startTime || endTime > 86_400) return []
    return [{ type, startTime, endTime, label: labels[type] }]
  }).sort((left, right) => left.startTime - right.startTime)
}

function cleanText(value, maximum) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, maximum) : undefined
}

function cleanUrl(value, maximum = 4096) {
  if (typeof value !== 'string' || value.length > maximum) return undefined
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && publicHostname(url.hostname)
      ? url.toString()
      : undefined
  } catch { return undefined }
}

function cleanPlaybackUrl(value, allowPrivate, maximum = 4096) {
  if (typeof value !== 'string' || value.length > maximum) return undefined
  try {
    const url = new URL(value)
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || !url.hostname) return undefined
    return publicHostname(url.hostname) || allowPrivate ? url.toString() : undefined
  } catch { return undefined }
}

function sanitizeStream(value, allowPrivate = false) {
  if (!value || typeof value !== 'object') return null
  const behavior = value.behaviorHints && typeof value.behaviorHints === 'object' ? value.behaviorHints : {}
  const url = cleanPlaybackUrl(value.url, allowPrivate)
  const infoHash = typeof value.infoHash === 'string' && /^(?:[a-f0-9]{40}|[a-z2-7]{32})$/i.test(value.infoHash)
    ? value.infoHash.toLowerCase()
    : undefined
  const subtitles = Array.isArray(value.subtitles) ? value.subtitles.slice(0, 8).flatMap((track) => {
    if (!track || typeof track !== 'object') return []
    const subtitleUrl = cleanUrl(track.url)
    return subtitleUrl ? [{ id: cleanText(track.id, 80), url: subtitleUrl, title: cleanText(track.title ?? track.name, 160), lang: cleanText(track.lang, 24) }] : []
  }) : []
  const sources = Array.isArray(value.sources) ? value.sources.slice(0, 16).flatMap((source) => (
    typeof source === 'string' && source.length <= 1_024 && /^tracker:(?:https?|udp):\/\//i.test(source)
      ? [source]
      : []
  )) : []
  if (!url && !infoHash) return null
  return {
    url,
    infoHash,
    fileIdx: Number.isInteger(value.fileIdx) && value.fileIdx >= 0 ? value.fileIdx : undefined,
    name: cleanText(value.name, 300),
    title: cleanText(value.title, 700),
    description: cleanText(value.description, 1_500),
    sources,
    subtitles,
    behaviorHints: {
      filename: cleanText(behavior.filename, 500),
      videoSize: Number.isFinite(behavior.videoSize) && behavior.videoSize > 0 ? Math.floor(behavior.videoSize) : undefined,
      bingeGroup: cleanText(behavior.bingeGroup, 160),
      notWebReady: behavior.notWebReady === true,
      proxyHeaders: behavior.proxyHeaders && typeof behavior.proxyHeaders === 'object'
        ? { request: behavior.proxyHeaders.request }
        : undefined,
    },
  }
}

async function resolveConfiguredDebrid(stream, profile, want, budgetMs = 22_000, signal) {
  const provider = profile.debrid?.provider
  const credential = profile.debrid?.credential
  if (!provider || !credential || !stream.infoHash) return null
  signal?.throwIfAborted()
  const controller = new AbortController()
  const cancel = () => controller.abort()
  signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => controller.abort(), budgetMs)
  try {
    const magnet = stream.__magnet || `magnet:?xt=urn:btih:${stream.infoHash}`
    const rawUrl = await resolveDebridHash(provider, credential, magnet, {
      want: {
        ...want,
        filename: stream.behaviorHints?.filename,
      },
      timeoutMs: Math.min(18_000, budgetMs),
      pollMs: 1_000,
      signal: controller.signal,
      priority: true,
    })
    const url = cleanUrl(rawUrl)
    if (!url) throw new Error(`${providerName(provider)} returned an invalid playback URL.`)
    const info = describe(stream)
    const name = providerName(provider)
    // Reuse the provider-neutral desktop adapter here. Providers that expose torrent sidecars
    // return them; every other supported provider safely returns an empty list.
    const sidecars = await resolveDebridSidecars(provider, credential, magnet, {
      want: {
        ...want,
        filename: stream.behaviorHints?.filename,
      },
      timeoutMs: Math.min(18_000, budgetMs),
      pollMs: 1_000,
      signal: controller.signal,
      priority: true,
    }).catch(() => [])
    const subtitles = sidecars.slice(0, 8).flatMap((track, index) => {
      const sidecarUrl = cleanUrl(track?.url)
      if (!sidecarUrl) return []
      return [{
        id: String(index + 1),
        url: sidecarUrl,
        title: cleanText(track?.title ?? track?.name, 160),
        lang: cleanText(track?.lang, 24),
      }]
    })
    return {
      id: `${stream.__candidate?.routeId ?? stream.infoHash}-${provider}-direct`,
      url,
      title: info.label.slice(0, 240),
      quality: info.quality,
      badges: [...new Set([...info.badges, name])].slice(0, 10),
      source: name,
      contentType: contentType({ ...stream, url }),
      subtitles,
      delivery: 'debrid',
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`${providerName(provider)} did not prepare this release in time. Try a cached source.`)
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
    // The desktop implementation caches an account listing for faster repeat playback. A Worker
    // isolate can serve several owners, so do not retain a Real-Debrid credential between calls.
    if (provider === 'realdebrid') rdForgetLists(credential)
  }
}

function playbackHeaders(stream) {
  const entries = Object.entries(stream.__headers ?? {})
  const unsupported = entries.some(([name]) => !['cookie', 'user-agent'].includes(name.trim().toLowerCase()))
  if (unsupported) return null
  const find = (name) => entries.find(([key]) => key.trim().toLowerCase() === name)?.[1]
  return { cookies: cleanText(find('cookie'), 4096), userAgent: cleanText(find('user-agent'), 512) }
}

function contentType(stream) {
  if (stream.__manifest === 'hls' || /\.m3u8(?:[?#]|$)/i.test(stream.url || '')) return 'application/vnd.apple.mpegurl'
  if (stream.__manifest === 'dash' || /\.mpd(?:[?#]|$)/i.test(stream.url || '')) return 'application/dash+xml'
  const filename = stream.behaviorHints?.filename || stream.url || ''
  if (/\.mkv(?:[?#]|$)/i.test(filename)) return 'video/x-matroska'
  if (/\.avi(?:[?#]|$)/i.test(filename)) return 'video/x-msvideo'
  if (/\.(?:ts|m2ts)(?:[?#]|$)/i.test(filename)) return 'video/mp2t'
  if (/\.webm(?:[?#]|$)/i.test(filename)) return 'video/webm'
  return 'video/mp4'
}

function directCandidate(stream, profile) {
  // Stremio's `notWebReady` means the URL is unsuitable for its browser player (for example an
  // MKV, plain HTTP URL, or a stream carrying proxyHeaders). Samsung AVPlay is not a browser, so
  // the hint alone must not discard otherwise portable debrid/direct URLs. Required headers and
  // non-public URLs are checked independently below.
  if (!stream.url || stream.__hosted) return null
  const url = cleanPlaybackUrl(stream.url, profile.allowPrivateNetworkSources)
  const headers = playbackHeaders(stream)
  if (!url || !headers) return null
  const info = describe(stream)
  const subtitles = (stream.__subtitles ?? []).slice(0, 8).flatMap((track, index) => {
    const url = cleanUrl(track.url)
    if (!url || Object.keys(track.headers ?? {}).length) return []
    return [{ id: track.id ?? String(index + 1), url, title: cleanText(track.title, 160), lang: cleanText(track.lang, 24) }]
  })
  return {
    id: stream.__candidate?.routeId ?? `candidate-${catalogInternals.fnv(url)}`,
    url,
    title: info.label.slice(0, 240),
    quality: info.quality,
    badges: info.badges.slice(0, 10),
    source: cleanText(info.addon ?? stream.__origin?.name, 120),
    contentType: contentType(stream),
    subtitles,
    ...(headers.cookies ? { cookies: headers.cookies } : {}),
    ...(headers.userAgent ? { userAgent: headers.userAgent } : {}),
    ...(publicHostname(new URL(url).hostname) ? {} : { lan: true }),
  }
}

async function mapLimit(values, limit, operation) {
  const output = new Array(values.length)
  let cursor = 0
  const worker = async () => {
    while (cursor < values.length) {
      const index = cursor++
      output[index] = await operation(values[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker))
  return output
}

async function resolveAddon(base, ids, type, fetcher, allowPrivate = false, addonIndex = 0, deadline = Infinity, subtitlesOnly = false, onStreams, onSubtitles) {
  const failures = []
  const failed = (message) => failures.push(`A configured source ${message}`)
  const manifest = await fetchJson(fetcher, addonEndpoint(base, '/manifest.json'), Math.min(MANIFEST_TIMEOUT_MS, deadline - Date.now()), failed)
  const subtitleResources = Array.isArray(manifest?.resources) ? manifest.resources : []
  const subtitleIds = ids.filter(id => subtitleResources.some(resource => {
    const spec = typeof resource === 'string' ? { name: resource } : resource
    if (!spec || typeof spec !== 'object') return false
    const types = spec.types ?? manifest.types
    const prefixes = spec.idPrefixes ?? manifest.idPrefixes
    return spec.name === 'subtitles' && (!Array.isArray(types) || !types.length || types.includes(type))
      && (!Array.isArray(prefixes) || !prefixes.length || prefixes.some(prefix => typeof prefix === 'string' && id.startsWith(prefix)))
  })).slice(0, 2)
  const subtitlesPromise = mapLimit(subtitleIds, 2, async id => {
    const result = await fetchJson(fetcher, addonEndpoint(base, `/subtitles/${type}/${encodeURIComponent(id)}.json`), Math.min(5_000, deadline - Date.now()))
    return (Array.isArray(result?.subtitles) ? result.subtitles : []).slice(0, 32).flatMap(track => {
      const url = cleanUrl(track?.url)
      return url ? [{ url, title: cleanText(track.title ?? track.name, 160), lang: cleanText(track.lang, 24) }] : []
    })
  }).then(lists => {
    const tracks = lists.flat()
    if (tracks.length) onSubtitles?.(tracks)
    return tracks
  })
  const ask = subtitlesOnly ? [] : ids.filter((id) => acceptsStreamId(manifest, type, id))
  const responses = await mapLimit(ask, 2, async (id) => {
    const result = await fetchJson(fetcher, addonEndpoint(base, `/stream/${type}/${encodeURIComponent(id)}.json`), Math.min(STREAM_TIMEOUT_MS, deadline - Date.now()), failed)
    return Array.isArray(result?.streams) ? result.streams.slice(0, MAX_STREAMS_PER_ADDON) : []
  })
  const addonName = cleanText(manifest?.name, 120) ?? new URL(base).hostname
  const streams = responses.flatMap((streams, requestIndex) => streams.flatMap((raw, upstreamRank) => {
    const clean = sanitizeStream(raw, allowPrivate)
    if (!clean) return []
    return [normalizeStreamBehavior({
      ...clean,
      __addonName: addonName,
      // The SAME opaque origin id the desktop stores in its source-priority order, so the synced
      // trust order recognises this row.
      __origin: { kind: 'addon', id: addonOriginId(base), name: addonName },
      __evidence: { upstreamRank, requestId: ask[requestIndex] },
    })]
  }))
  const batch = { streams, failures, tvRequests: failures.length ? tvSourceRequests(base, ask, type, addonIndex) : [] }
  onStreams?.(batch)
  return { ...batch, subtitles: await subtitlesPromise }
}

async function embeddedStremioStreams(request, bases, plan, fetcher, allowPrivate = false) {
  if (request.ref.provider !== 'stremio' || !plan.addonId || !bases.length) {
    return { declared: false, streams: [] }
  }
  const identity = decodeStremioRef(request.ref.id)
  const base = identity ? bases.find((candidate) => (
    catalogInternals.fnv(catalogInternals.normalizeBase(candidate)) === identity.addonId
  )) : undefined
  if (!identity || !base) return { declared: false, streams: [] }
  const value = await fetchJson(
    fetcher,
    addonEndpoint(base, `/meta/${encodeURIComponent(identity.type)}/${encodeURIComponent(identity.id)}.json`),
    METADATA_TIMEOUT_MS,
  )
  const videos = Array.isArray(value?.meta?.videos) ? value.meta.videos : []
  const selected = videos.find((entry) => typeof entry?.id === 'string' && plan.ids.includes(entry.id))
    ?? videos.find((entry) => request.episode != null
      && Number(entry?.episode) === request.episode
      && (request.season == null || Number(entry?.season) === request.season))
  if (!selected || !Array.isArray(selected.streams)) return { declared: false, streams: [] }
  if (isSupplementalVideo({ title: selected.title ?? selected.name, description: selected.overview, name: selected.type }, request.title)) {
    return { declared: false, streams: [] }
  }
  const streams = selected.streams.slice(0, MAX_STREAMS_PER_ADDON).flatMap((raw, upstreamRank) => {
    const clean = sanitizeStream(raw, allowPrivate)
    if (!clean) return []
    return [normalizeStreamBehavior({
      ...clean,
      __addonName: 'Embedded source',
      __origin: { kind: 'addon', id: addonOriginId(base), name: 'Embedded source' },
      __evidence: { upstreamRank, requestId: selected.id },
    })]
  })
  return { declared: true, streams }
}

export function prepareTvSourceContinuation(profileValue, requestValue, context) {
  return verifyTvSourceLookup(normalizeResolverProfile(profileValue), normalizeResolveRequest(requestValue), requestValue.tvSourceResults, context)
}

function sourcePool(batches, request, profile, refineContext, complete = true) {
  const normalized = dedupeStreams(batches.flatMap(batch => batch.streams).filter(stream => !isNotice(stream) && !isSupplementalVideo(stream, request.title) && isTvVideoCompatible(stream, request.videoCapabilities)))
  const refined = refineContext ? refineStreamsLite(refineContext, normalized) : { kept: normalized, rejectedCount: 0 }
  // Only the complete pool may use the existing empty-filter fallback.
  const pool = applyPriorityFilter(refined.kept.length || !complete ? refined.kept : normalized, profile.sourcePriority ?? [], profile.sourcePriorityMode ?? 'prefer')
  return { normalized, refined, pool }
}

function orderedSources(pool, profile, plan) {
  const preferred = pickCandidates(pool, profile.quality, plan.want, undefined, {
    audioLang: profile.audioLang || undefined, cacheCheck: 'none', allowUncached: !!profile.debrid, sourcePriority: profile.sourcePriority,
  })
  return [...new Set([...preferred, ...pickCandidates(pool, profile.quality, plan.want, undefined, {
    cacheCheck: 'none', allowUncached: !!profile.debrid, sourcePriority: profile.sourcePriority,
  })])]
}

function sourcePreferences(profile) {
  return {
    ...(profile.subtitleLang || profile.audioLang ? { trackPreferences: {
      ...(profile.audioLang ? { audio: { language: profile.audioLang } } : {}),
      ...(profile.subtitleLang && profile.subtitleLang !== 'none' ? { subtitle: { language: profile.subtitleLang } } : {}),
    } } : {}),
    ...(profile.subtitleStyle ? { subtitleStyle: profile.subtitleStyle } : {}),
  }
}

export async function resolveDirectSources(profileValue, requestValue, fetcher = fetch, options = {}) {
  const signal = options.signal
  signal?.throwIfAborted()
  if (signal) {
    const upstream = fetcher
    fetcher = (url, init = {}) => { signal.throwIfAborted(); return upstream(url, { ...init, signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal }) }
  }
  const debridDeadline = Date.now() + (options.fetchSource ? 40_000 : 25_000)
  const profile = normalizeResolverProfile(profileValue)
  const request = normalizeResolveRequest(requestValue)
  if (!profile.enabled) throw new Error('Cloud source resolving is disabled for this TV.')
  if (!profile.addons.length) throw new Error('No cloud resolver add-ons are configured.')
  const plan = options.tvContinuation?.plan ?? await streamRequestPlan(request, fetcher, profile)
  if (!plan.ids.length) return { candidates: [], selectedId: null, queriedIds: [], rejected: 0 }
  // Runs beside the add-on fan-out, so title/year/runtime evidence costs no wall-clock time.
  const refineContextPromise = refineContextFor(request, plan, profile, fetcher).catch(() => null)
  const serviceSubtitlesPromise = searchSubtitleServices(profile, request, plan, fetcher).catch(() => [])
  const skipSegmentsPromise = resolveSkipSegments(plan, request, fetcher).catch(() => [])
  // IMDb/TMDB identifiers belong to the title, not the catalogue that displayed it.
  // Keep custom namespaces scoped, but let every configured stream add-on answer global IDs.
  const globalIds = plan.ids.filter((id) => /^(?:tt\d+|tmdb:\d+)(?::\d+:\d+)?$/.test(id))
  const resolverAddons = plan.addonId && !globalIds.length
    ? profile.addons.filter(base => catalogInternals.fnv(catalogInternals.normalizeBase(base)) === plan.addonId)
    : profile.addons
  const idsForAddon = base => plan.addonId && catalogInternals.fnv(catalogInternals.normalizeBase(base)) !== plan.addonId
    ? globalIds : plan.ids
  const embedded = options.tvContinuation ? { declared: false, streams: [] } : await embeddedStremioStreams(
    request, resolverAddons, plan, fetcher, profile.allowPrivateNetworkSources,
  )
  const resourceType = request.ref.provider === 'stremio' ? request.nativeType ?? request.streamType : request.streamType
  const sourceDeadline = Date.now() + 12_000
  const observed = []
  const delegated = []
  const delegatedBatches = []
  const debridAttempts = new Map()
  const debridResults = new Map()
  const debridFailures = []
  const cacheStates = new Map()
  let preparing = Promise.resolve()
  let progress = Promise.resolve()
  let progressError
  let lastProgressKey = ''
  const availableCandidates = ordered => ordered.flatMap(stream => {
    const direct = directCandidate(stream, profile)
    const value = direct ? { ...direct, delivery: 'direct' } : debridResults.get(stream.infoHash)
    return value && !request.excludeCandidateIds?.includes(value.id) ? [value] : []
  }).slice(0, MAX_RESPONSE_CANDIDATES)
  const addonSubtitleBatches = []
  let serviceSubtitles = []
  // Sidecars remain first; independently installed subtitle add-ons fill the remaining slots.
  // Copies keep shared debrid results unmutated, and the byte bound keeps a full response and
  // its progress events inside the resolve channel's message limit.
  const withSubtitles = list => list.map(candidate => {
    const seen = new Set()
    const merged = [...(candidate.subtitles ?? []), ...addonSubtitleBatches.flat(), ...(plan.subtitleTracks ?? []), ...serviceSubtitles]
      .filter(track => {
        const key = track.url ?? JSON.stringify(track.download)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .filter((track, index, tracks) => index < 40 && encoder.encode(JSON.stringify(tracks.slice(0, index + 1))).length < 8_000)
    return { ...candidate, subtitles: merged }
  })
  const publishCandidates = async candidates => {
    const merged = withSubtitles(candidates)
    const key = JSON.stringify(merged)
    if (!merged.length || key === lastProgressKey) return
    lastProgressKey = key
    await options.onProgress({ candidates: structuredClone(merged), selectedId: merged[0].id, ...sourcePreferences(profile) })
  }
  const prepareOnce = stream => {
    if (!debridAttempts.has(stream.infoHash)) {
      const work = resolveConfiguredDebrid(stream, profile, plan.want, Math.min(7_500, Math.max(1, debridDeadline - Date.now())), signal)
        .then(value => { if (value) debridResults.set(stream.infoHash, value); return value })
        .catch(error => {
          const message = cleanText(error instanceof Error ? error.message : String(error), 240)
          if (message) debridFailures.push(message)
          return null
        })
      debridAttempts.set(stream.infoHash, work)
    }
    return debridAttempts.get(stream.infoHash)
  }
  const checkPool = async pool => {
    if (!profile.debrid || cacheCheckMode(profile.debrid.provider) !== 'native' || pool.some(stream => directCandidate(stream, profile))) return
    const hashes = [...new Set(pool.map(stream => stream.infoHash).filter(hash => hash && !cacheStates.has(hash)))].slice(0, 240)
    if (hashes.length) {
      signal?.throwIfAborted()
      const cached = await checkCached(profile.debrid.provider, profile.debrid.credential, hashes)
      for (const hash of hashes) cacheStates.set(hash, cached.get(hash) ?? null)
    }
    for (const stream of pool) {
      const state = cacheStates.get(stream.infoHash)
      if (state) { stream.__cache = state; stream.__cacheSource = 'native' }
    }
  }
  const showProgress = () => {
    if (!options.onProgress) return
    const snapshot = observed.slice()
    progress = progress.then(async () => {
      signal?.throwIfAborted()
      const { pool } = sourcePool(snapshot, request, profile, await refineContextPromise, false)
      await publishCandidates(availableCandidates(orderedSources(pool, profile, plan)))
    }).catch(error => { progressError = error })
  }
  void serviceSubtitlesPromise.then(tracks => { serviceSubtitles = tracks; showProgress() })
  const showBatch = batch => {
    observed.push(batch)
    showProgress()
    if (!options.onProgress || !profile.debrid) return
    // Prepare releases alongside source discovery. Memoize the external job so the final
    // ranking pass and a reconnect cannot create it again. Direct progress has a separate queue.
    preparing = preparing.then(async () => {
      signal?.throwIfAborted()
      const { pool } = sourcePool(observed, request, profile, await refineContextPromise, false)
      await checkPool(pool)
      for (const stream of orderedSources(pool, profile, plan).slice(0, MAX_RESPONSE_CANDIDATES)) {
        signal?.throwIfAborted()
        if (Date.now() >= debridDeadline || debridAttempts.size >= MAX_RESPONSE_CANDIDATES) break
        if (directCandidate(stream, profile) || !stream.infoHash || debridAttempts.has(stream.infoHash)
          || request.excludeCandidateIds?.includes(`${stream.__candidate?.routeId ?? stream.infoHash}-${profile.debrid.provider}-direct`)) continue
        await prepareOnce(stream)
        showProgress()
      }
    }).catch(error => { progressError = error })
  }
  if (!options.tvContinuation) showBatch({ streams: embedded.streams, failures: [] })
  const batches = options.tvContinuation
    ? [{ streams: options.tvContinuation.streams.flatMap((raw, upstreamRank) => {
      const stream = sanitizeStream(raw)
      return stream ? [normalizeStreamBehavior({ ...stream, __addonName: 'TV source',
        __origin: { kind: 'addon', id: 'tv-source', name: 'TV source' }, __evidence: { upstreamRank } })] : []
    }), failures: [] }]
    : [
      { streams: embedded.streams, failures: [] },
      ...await mapLimit(resolverAddons, 3, (base, index) => resolveAddon(base, idsForAddon(base), resourceType, fetcher, profile.allowPrivateNetworkSources, index, sourceDeadline, false, batch => {
        showBatch(batch)
        if (!options.fetchSource || !profile.debrid) return
        for (const query of batch.tvRequests) {
          const work = options.fetchSource(query).then(raw => {
            signal?.throwIfAborted()
            const streams = raw.flatMap((value, upstreamRank) => {
              const clean = sanitizeStream(value)
              return clean ? [normalizeStreamBehavior({ ...clean, __addonName: 'TV source',
                __origin: { kind: 'addon', id: addonOriginId(base), name: 'TV source' }, __evidence: { upstreamRank } })] : []
            })
            const received = { streams, failures: [] }
            delegatedBatches.push(received)
            showBatch(received)
          }).catch(error => { if (signal?.aborted) progressError = error })
          delegated.push(work)
        }
      }, tracks => { addonSubtitleBatches.push(tracks); showProgress() })),
    ]
  await Promise.all(delegated)
  batches.push(...delegatedBatches)
  await preparing
  await progress
  if (progressError) throw progressError
  signal?.throwIfAborted()
  const refineContext = await refineContextPromise
  const { normalized, refined, pool } = sourcePool(batches, request, profile, refineContext)
  // TV lookup returns plain torrent hashes. Check the configured provider before choosing a
  // release so a cached result is not stuck behind several full torrent downloads.
  await checkPool(pool)
  const ordered = orderedSources(pool, profile, plan)
  const candidates = []
  const failures = batches.flatMap((batch) => batch.failures)
  let rejected = refined.kept.length ? refined.rejectedCount : 0
  const attemptedDebridHashes = new Set()
  for (const stream of ordered) {
    signal?.throwIfAborted()
    const candidate = directCandidate(stream, profile)
    const candidateId = candidate?.id ?? `${stream.__candidate?.routeId ?? stream.infoHash}-${profile.debrid?.provider}-direct`
    if (request.excludeCandidateIds?.includes(candidateId)) continue
    if (candidate) candidates.push({ ...candidate, delivery: 'direct' })
    else if (candidates.length < MAX_RESPONSE_CANDIDATES && (Date.now() < debridDeadline || debridResults.has(stream.infoHash)) && profile.debrid && stream.infoHash
      && !attemptedDebridHashes.has(stream.infoHash)) {
      attemptedDebridHashes.add(stream.infoHash)
      try {
        const remaining = debridDeadline - Date.now()
        if (remaining <= 0 && !debridResults.has(stream.infoHash)) throw new Error('Source resolution timed out. Try another cached release.')
        const resolved = await prepareOnce(stream)
        if (resolved) {
          candidates.push(resolved)
        }
      } catch (error) {
        rejected += 1
        const message = cleanText(error instanceof Error ? error.message : String(error), 240)
        if (message) failures.push(message)
      }
    } else rejected += 1
    if (options.onProgress) await publishCandidates(availableCandidates(ordered))
    if (candidates.length >= MAX_RESPONSE_CANDIDATES) break
  }
  candidates.splice(MAX_RESPONSE_CANDIDATES)
  const addonSubtitles = batches.flatMap(batch => batch.subtitles ?? []).concat(plan.subtitleTracks ?? [], await serviceSubtitlesPromise)
  const finalCandidates = withSubtitles(candidates)
  signal?.throwIfAborted()
  const tvSourceLookup = !options.fetchSource && candidates.length < MAX_RESPONSE_CANDIDATES && requestValue.tvSourceLookup === 1 && !options.tvContinuation && options.tvLookupContext
    ? await createTvSourceLookup(profile, request, { ...plan, subtitleTracks: addonSubtitles.filter((track, index, tracks) =>
      encoder.encode(JSON.stringify(tracks.slice(0, index + 1))).length < 8_000) }, batches.flatMap((batch) => batch.tvRequests ?? []), options.tvLookupContext)
    : undefined
  if (!candidates.length && !failures.length && !debridFailures.length) {
    failures.push(!normalized.length
      ? 'Your configured source add-ons returned no playable streams for this title.'
      : !profile.debrid && normalized.some((stream) => stream.infoHash)
        ? 'The Worker has no saved debrid credential for these torrent sources. Save TV playback settings in izumi again.'
        : `${profile.debrid ? providerName(profile.debrid.provider) + ' is configured, but the' : 'The'} returned sources could not be played on the TV.`)
  }
  return {
    candidates: finalCandidates,
    selectedId: finalCandidates[0]?.id ?? null,
    queriedIds: plan.ids,
    rejected,
    failures: [...new Set([...failures, ...debridFailures])].slice(0, 3),
    skipSegments: await skipSegmentsPromise,
    ...sourcePreferences(profile),
    ...(tvSourceLookup ? { tvSourceLookup } : {}),
  }
}

function cloudCatalogProfile(profileValue) {
  const profile = normalizeResolverProfile(profileValue)
  return { ...profile.catalog, addons: profile.addons }
}

export async function resolveCatalogSnapshot(profileValue, screen) {
  return catalogSnapshot(cloudCatalogProfile(profileValue), typeof screen === 'string' ? screen : '')
}

export async function searchCatalog(profileValue, screen, query, person, genre) {
  return catalogSearch(cloudCatalogProfile(profileValue), typeof screen === 'string' ? screen : '', query, person, genre)
}

export function defaultResolverProfile() {
  return { ...DEFAULT_PROFILE, addons: [], catalog: { ...DEFAULT_PROFILE.catalog, screens: [...DEFAULT_PROFILE.catalog.screens] } }
}
