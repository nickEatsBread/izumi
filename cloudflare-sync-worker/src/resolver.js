// @ts-nocheck -- Wrangler validates this Worker module; the root app checker cannot model its
// cross-package TypeScript import without changing the browser application's compiler contract.
import {
  acceptsStreamId,
  buildStreamIds,
  dedupeStreams,
  describe,
  isNotice,
  normalizeStreamBehavior,
  pickCandidates,
} from './generated/resolver-core/resolver-core.ts'
import {
  providerName,
  providers,
  resolveHash as resolveDebridHash,
  resolveSidecars as resolveDebridSidecars,
} from './generated/resolver-core/debrid/index.ts'
import { rdForgetLists } from './generated/resolver-core/debrid/providers/realdebrid.ts'
import { catalogInternals, catalogSearch, catalogSnapshot, decodeStremioRef } from './catalog.js'

const MAX_ADDONS = 8
const MAX_ADDON_URL_BYTES = 2048
const MAX_STREAM_IDS = 6
const MAX_STREAMS_PER_ADDON = 80
const MAX_RESPONSE_CANDIDATES = 12
const MAX_PROVIDER_RESPONSE_BYTES = 512 * 1024
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

export function normalizeResolverProfile(value, workerOrigin = '') {
  if (!value || typeof value !== 'object') throw new Error('Resolver profile must be a JSON object.')
  const input = value
  if (!Array.isArray(input.addons) || input.addons.length > MAX_ADDONS) {
    throw new Error(`Configure no more than ${MAX_ADDONS} resolver add-ons.`)
  }
  const addons = [...new Set(input.addons.map((entry) => normalizeAddonBase(entry, workerOrigin)))]
  const quality = QUALITY.has(String(input.quality)) ? String(input.quality) : 'any'
  const sort = SORT.has(String(input.sort)) ? String(input.sort) : 'quality'
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
    addons,
    quality,
    sort,
    audioLang,
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
  return { ref: { provider, type, id }, episode, season, streamType, streamIds }
}

function addonEndpoint(base, suffix) {
  const url = new URL(base)
  const search = url.search
  url.search = ''
  url.pathname = `${url.pathname.replace(/\/$/, '')}${suffix}`
  url.search = search
  return url.toString()
}

async function fetchJson(fetcher, url, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Izumi-Cloud-Resolver/1' },
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!response.ok) return null
    const announced = Number(response.headers.get('content-length') || 0)
    if (announced > MAX_PROVIDER_RESPONSE_BYTES) return null
    const text = await response.text()
    if (encoder.encode(text).byteLength > MAX_PROVIDER_RESPONSE_BYTES) return null
    return JSON.parse(text)
  } catch { return null } finally { clearTimeout(timer) }
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
    description: summary.description, poster: summary.poster, backdrop: summary.backdrop,
    runtimeMinutes: summary.runtimeMinutes, ratings: summary.ratings,
  } : {})
}

async function tmdbDetails(request, profile) {
  if (!/^\d{1,12}$/.test(request.ref.id) || !profile.catalog.tmdbToken) return null
  const kind = request.ref.type === 'movie' ? 'movie' : 'tv'
  const detail = await catalogInternals.tmdbRequest(profile.catalog.tmdbToken, `/${kind}/${encodeURIComponent(request.ref.id)}`, {
    append_to_response: 'videos,images,release_dates,content_ratings,recommendations,credits,aggregate_credits',
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
  const base = profile.addons.map(catalogInternals.normalizeBase).find((candidate) => catalogInternals.fnv(candidate) === identity.addonId)
  if (!base) return null
  let raw = null
  try {
    const url = new URL(base)
    const search = url.search
    url.search = ''
    url.pathname = `${url.pathname.replace(/\/$/, '')}/meta/${encodeURIComponent(identity.type)}/${encodeURIComponent(identity.id)}.json`
    url.search = search
    raw = (await catalogInternals.fetchJson(url.toString()))?.meta
  } catch { /* The compact catalogue summary remains usable. */ }
  if (!raw) return null
  const summary = catalogInternals.stremioMedia(raw, base, identity.type)
  const episodes = (raw.videos ?? []).flatMap((entry, index) => {
    const episode = Number(entry?.episode ?? index + 1)
    const season = Number(entry?.season ?? 1)
    return Number.isInteger(episode) && episode > 0 && Number.isInteger(season) && season >= 0 ? [{
      season, episode,
      title: cleanText(entry.title, 300), description: cleanText(entry.overview, 1_500),
      image: cleanUrl(entry.thumbnail), releasedAt: cleanText(entry.released, 40),
    }] : []
  })
  return detailEnvelope(episodes, summary ? {
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

export async function streamRequestPlan(request, fetcher = fetch) {
  if (request.streamIds.length) {
    return { ids: request.streamIds, want: request.episode ? { episode: request.episode, season: request.season } : undefined }
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
    return {
      ids: buildStreamIds({
        type: request.streamType,
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
  return { ids, want, malId: Number(mappings.mal_id) || undefined }
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
    return subtitleUrl ? [{ id: cleanText(track.id, 80), url: subtitleUrl, lang: cleanText(track.lang, 24) }] : []
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

async function resolveConfiguredDebrid(stream, profile, want) {
  const provider = profile.debrid?.provider
  const credential = profile.debrid?.credential
  if (!provider || !credential || !stream.infoHash) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 22_000)
  try {
    const magnet = stream.__magnet || `magnet:?xt=urn:btih:${stream.infoHash}`
    const rawUrl = await resolveDebridHash(provider, credential, magnet, {
      want: {
        ...want,
        filename: stream.behaviorHints?.filename,
      },
      timeoutMs: 18_000,
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
      timeoutMs: 18_000,
      pollMs: 1_000,
      signal: controller.signal,
      priority: true,
    })
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
      title: info.label.slice(0, 500),
      quality: info.quality,
      badges: [...new Set([...info.badges, name])].slice(0, 10),
      source: name,
      contentType: contentType({ ...stream, url }),
      subtitles,
      delivery: 'debrid',
    }
  } finally {
    clearTimeout(timer)
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
    id: stream.__candidate?.routeId ?? `candidate-${Math.random().toString(36).slice(2)}`,
    url,
    title: info.label.slice(0, 500),
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

async function resolveAddon(base, ids, type, fetcher, allowPrivate = false) {
  const manifest = await fetchJson(fetcher, addonEndpoint(base, '/manifest.json'), MANIFEST_TIMEOUT_MS)
  const ask = ids.filter((id) => acceptsStreamId(manifest, type, id))
  const responses = await mapLimit(ask, 2, async (id) => {
    const result = await fetchJson(fetcher, addonEndpoint(base, `/stream/${type}/${encodeURIComponent(id)}.json`), STREAM_TIMEOUT_MS)
    return Array.isArray(result?.streams) ? result.streams.slice(0, MAX_STREAMS_PER_ADDON) : []
  })
  const addonName = cleanText(manifest?.name, 120) ?? new URL(base).hostname
  return responses.flatMap((streams, requestIndex) => streams.flatMap((raw, upstreamRank) => {
    const clean = sanitizeStream(raw, allowPrivate)
    if (!clean) return []
    return [normalizeStreamBehavior({
      ...clean,
      __addonName: addonName,
      __origin: { kind: 'addon', id: `cloud-addon-${new URL(base).hostname}`, name: addonName },
      __evidence: { upstreamRank, requestId: ask[requestIndex] },
    })]
  }))
}

export async function resolveDirectSources(profileValue, requestValue, fetcher = fetch) {
  const profile = normalizeResolverProfile(profileValue)
  const request = normalizeResolveRequest(requestValue)
  if (!profile.enabled) throw new Error('Cloud source resolving is disabled for this TV.')
  if (!profile.addons.length) throw new Error('No cloud resolver add-ons are configured.')
  const plan = await streamRequestPlan(request, fetcher)
  if (!plan.ids.length) return { candidates: [], selectedId: null, queriedIds: [], rejected: 0 }
  const skipSegmentsPromise = resolveSkipSegments(plan, request, fetcher).catch(() => [])
  const resolverAddons = plan.addonId
    ? profile.addons.filter((base) => catalogInternals.fnv(catalogInternals.normalizeBase(base)) === plan.addonId)
    : profile.addons
  const batches = await mapLimit(resolverAddons, 2, (base) => resolveAddon(base, plan.ids, request.streamType, fetcher, profile.allowPrivateNetworkSources))
  const normalized = dedupeStreams(batches.flat().filter((stream) => !isNotice(stream)))
  const ordered = pickCandidates(normalized, profile.quality, plan.want, undefined, {
    audioLang: profile.audioLang || undefined,
    cacheCheck: 'none',
    allowUncached: !!profile.debrid,
  })
  const candidates = []
  const failures = []
  let rejected = 0
  let debridAttempted = false
  for (const stream of ordered) {
    const candidate = directCandidate(stream, profile)
    if (candidate) candidates.push({ ...candidate, delivery: 'direct' })
    else if (!debridAttempted && profile.debrid && stream.infoHash) {
      debridAttempted = true
      try {
        const resolved = await resolveConfiguredDebrid(stream, profile, plan.want)
        if (resolved) candidates.push(resolved)
      } catch (error) {
        rejected += 1
        const message = cleanText(error instanceof Error ? error.message : String(error), 240)
        if (message) failures.push(message)
      }
    } else rejected += 1
    if (candidates.length >= MAX_RESPONSE_CANDIDATES) break
  }
  candidates.splice(MAX_RESPONSE_CANDIDATES)
  return {
    candidates,
    selectedId: candidates[0]?.id ?? null,
    queriedIds: plan.ids,
    rejected,
    failures: [...new Set(failures)].slice(0, 3),
    skipSegments: await skipSegmentsPromise,
  }
}

function cloudCatalogProfile(profileValue) {
  const profile = normalizeResolverProfile(profileValue)
  return { ...profile.catalog, addons: profile.addons }
}

export async function resolveCatalogSnapshot(profileValue, screen) {
  return catalogSnapshot(cloudCatalogProfile(profileValue), typeof screen === 'string' ? screen : '')
}

export async function searchCatalog(profileValue, screen, query, person) {
  return catalogSearch(cloudCatalogProfile(profileValue), typeof screen === 'string' ? screen : '', query, person)
}

export function defaultResolverProfile() {
  return { ...DEFAULT_PROFILE, addons: [], catalog: { ...DEFAULT_PROFILE.catalog, screens: [...DEFAULT_PROFILE.catalog.screens] } }
}
