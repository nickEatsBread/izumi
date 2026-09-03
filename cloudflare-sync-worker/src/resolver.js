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
const encoder = new TextEncoder()

const DEFAULT_PROFILE = Object.freeze({
  enabled: false,
  addons: [],
  quality: 'any',
  sort: 'quality',
  audioLang: '',
  connectedDeviceFallback: false,
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
  return {
    enabled: input.enabled === true,
    addons,
    quality,
    sort,
    audioLang,
    connectedDeviceFallback: input.connectedDeviceFallback === true,
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

/** Resolve the public, non-secret episode library used by the TV series screen. Playback sources
 * stay in the resolver profile; this endpoint only returns titles, summaries and artwork. */
export async function resolveMediaDetails(value, fetcher = fetch) {
  const request = normalizeResolveRequest(value)
  if (request.ref.provider !== 'anilist') return null
  const metadata = await metadataFor(request, fetcher)
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
  if (!entries.length) return null
  const seasons = new Map()
  for (const entry of entries) seasons.set(entry.season, Math.max(seasons.get(entry.season) ?? 0, entry.episode))
  const orderedSeasons = [...seasons.entries()].sort(([left], [right]) => left - right)
  return {
    episodes: entries.map(({ absolute: _absolute, ...episode }) => episode),
    seasonEpisodeCounts: orderedSeasons.map(([, count]) => count),
    seasonLabels: orderedSeasons.map(([season]) => season === 0 ? 'Specials' : `Season ${season}`),
  }
}

export async function streamRequestPlan(request, fetcher = fetch) {
  if (request.streamIds.length) {
    return { ids: request.streamIds, want: request.episode ? { episode: request.episode, season: request.season } : undefined }
  }
  if (request.ref.provider === 'stremio') return { ids: [request.ref.id], want: undefined }
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
  return { ids, want }
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

function sanitizeStream(value) {
  if (!value || typeof value !== 'object') return null
  const behavior = value.behaviorHints && typeof value.behaviorHints === 'object' ? value.behaviorHints : {}
  const url = cleanUrl(value.url)
  const infoHash = typeof value.infoHash === 'string' && /^(?:[a-f0-9]{40}|[a-z2-7]{32})$/i.test(value.infoHash)
    ? value.infoHash.toLowerCase()
    : undefined
  const subtitles = Array.isArray(value.subtitles) ? value.subtitles.slice(0, 8).flatMap((track) => {
    if (!track || typeof track !== 'object') return []
    const subtitleUrl = cleanUrl(track.url)
    return subtitleUrl ? [{ id: cleanText(track.id, 80), url: subtitleUrl, lang: cleanText(track.lang, 24) }] : []
  }) : []
  if (!url && !infoHash) return null
  return {
    url,
    infoHash,
    fileIdx: Number.isInteger(value.fileIdx) && value.fileIdx >= 0 ? value.fileIdx : undefined,
    name: cleanText(value.name, 300),
    title: cleanText(value.title, 700),
    description: cleanText(value.description, 1_500),
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

function directCandidate(stream) {
  // Stremio's `notWebReady` means the URL is unsuitable for its browser player (for example an
  // MKV, plain HTTP URL, or a stream carrying proxyHeaders). Samsung AVPlay is not a browser, so
  // the hint alone must not discard otherwise portable debrid/direct URLs. Required headers and
  // non-public URLs are checked independently below.
  if (!stream.url || stream.__hosted) return null
  const url = cleanUrl(stream.url)
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

async function resolveAddon(base, ids, type, fetcher) {
  const manifest = await fetchJson(fetcher, addonEndpoint(base, '/manifest.json'), MANIFEST_TIMEOUT_MS)
  const ask = ids.filter((id) => acceptsStreamId(manifest, type, id))
  const responses = await mapLimit(ask, 2, async (id) => {
    const result = await fetchJson(fetcher, addonEndpoint(base, `/stream/${type}/${encodeURIComponent(id)}.json`), STREAM_TIMEOUT_MS)
    return Array.isArray(result?.streams) ? result.streams.slice(0, MAX_STREAMS_PER_ADDON) : []
  })
  const addonName = cleanText(manifest?.name, 120) ?? new URL(base).hostname
  return responses.flatMap((streams, requestIndex) => streams.flatMap((raw, upstreamRank) => {
    const clean = sanitizeStream(raw)
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
  const batches = await mapLimit(profile.addons, 2, (base) => resolveAddon(base, plan.ids, request.streamType, fetcher))
  const normalized = dedupeStreams(batches.flat().filter((stream) => !isNotice(stream)))
  const portable = []
  let rejected = 0
  for (const stream of normalized) {
    if (directCandidate(stream)) portable.push(stream)
    else rejected += 1
  }
  const ordered = pickCandidates(portable, profile.quality, plan.want, undefined, {
    audioLang: profile.audioLang || undefined,
    cacheCheck: 'none',
  })
  const candidates = ordered.slice(0, MAX_RESPONSE_CANDIDATES).flatMap((stream) => {
    const candidate = directCandidate(stream)
    return candidate ? [candidate] : []
  })
  return { candidates, selectedId: candidates[0]?.id ?? null, queriedIds: plan.ids, rejected }
}

export function defaultResolverProfile() {
  return { ...DEFAULT_PROFILE, addons: [] }
}
