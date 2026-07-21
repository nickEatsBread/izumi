import type { Stream } from '$lib/stremio/parse'
import { torrentioResolverInfoHash } from '$lib/stremio/resolver-url'

export type SharedSource =
  | {
      version: 1
      kind: 'torrent'
      infoHash: string
      filename?: string
      videoSize?: number
      bingeGroup?: string
      name?: string
      title?: string
    }
  | {
      version: 1
      kind: 'http'
      url: string
      filename?: string
      videoSize?: number
      name?: string
      title?: string
    }

export interface SharedSourceState {
  source: SharedSource | null
  error: string
}

const SECRET_QUERY_KEY = /(^|[_-])(api[-_]?key|key|access[-_]?token|token|auth|authorization|cookie|credential|password|secret|signature|sig)([_-]|$)/i
const SECRET_HEADER = /^(authorization|cookie|proxy-authorization|x-api-key)$/i

function short(value: string | undefined, limit = 300): string | undefined {
  const clean = value?.trim()
  return clean ? clean.slice(0, limit) : undefined
}

function safeHttpUrl(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    if ([...url.searchParams.keys()].some((key) => SECRET_QUERY_KEY.test(key))) return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

/**
 * Build the source identity that may cross a Watch Together room.
 *
 * Torrent playback shares only the hash and file hint, never the locally-resolved
 * debrid CDN URL. Direct HTTP is shared only when it has no credential-bearing
 * headers, URL userinfo, or recognisable secret query parameter.
 */
export function shareableSource(stream: Stream): SharedSourceState {
  const filename = short(stream.behaviorHints?.filename, 500)
  const videoSize = Number.isFinite(stream.behaviorHints?.videoSize)
    ? Math.max(0, Math.floor(stream.behaviorHints!.videoSize!))
    : undefined

  // Torrentio puts the debrid credential in its resolver URL path. Treat that URL as the torrent
  // identity it represents, not shareable HTTP, so the private token can never cross the room.
  const resolverHash = torrentioResolverInfoHash(stream.url, stream.__addonName ?? stream.name)
  if (stream.infoHash || resolverHash) {
    const infoHash = (stream.infoHash ?? resolverHash)!.trim().toLowerCase()
    if (!/^[a-f0-9]{40}$/.test(infoHash) && !/^[a-z2-7]{32}$/.test(infoHash)) {
      return { source: null, error: 'The selected torrent has an invalid info hash.' }
    }
    return {
      source: {
        version: 1,
        kind: 'torrent',
        infoHash,
        filename,
        videoSize,
        bingeGroup: short(stream.behaviorHints?.bingeGroup),
        name: short(stream.name),
        title: short(stream.title, 500),
      },
      error: '',
    }
  }

  if (!stream.url) return { source: null, error: 'The selected source has no shareable torrent or HTTP address.' }
  const headers = stream.__headers ?? {}
  if (Object.keys(headers).some((name) => SECRET_HEADER.test(name)) || Object.keys(headers).length > 0) {
    return { source: null, error: 'This HTTP source needs private request headers, so Izumi will not send it to the room.' }
  }
  const url = safeHttpUrl(stream.url)
  if (!url) {
    return { source: null, error: 'This HTTP source contains credentials or is local to the host, so Izumi will not send it to the room.' }
  }
  return {
    source: { version: 1, kind: 'http', url, filename, videoSize, name: short(stream.name), title: short(stream.title, 500) },
    error: '',
  }
}

export function streamFromSharedSource(source: SharedSource): Stream {
  const behaviorHints = {
    filename: source.filename,
    videoSize: source.videoSize,
    ...(source.kind === 'torrent' && source.bingeGroup ? { bingeGroup: source.bingeGroup } : {}),
  }
  return source.kind === 'torrent'
    ? { infoHash: source.infoHash, name: source.name, title: source.title, behaviorHints }
    : { url: source.url, name: source.name, title: source.title, behaviorHints, __stream: true }
}

/** Validate and normalize an untrusted source received from a peer. */
export function parseSharedSource(value: unknown): SharedSource | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<SharedSource>
  if (candidate.version !== 1) return null
  if (candidate.kind === 'torrent' && typeof candidate.infoHash === 'string') {
    return shareableSource({
      infoHash: candidate.infoHash,
      name: typeof candidate.name === 'string' ? candidate.name : undefined,
      title: typeof candidate.title === 'string' ? candidate.title : undefined,
      behaviorHints: {
        filename: typeof candidate.filename === 'string' ? candidate.filename : undefined,
        videoSize: typeof candidate.videoSize === 'number' ? candidate.videoSize : undefined,
        bingeGroup: typeof candidate.bingeGroup === 'string' ? candidate.bingeGroup : undefined,
      },
    }).source
  }
  if (candidate.kind === 'http' && typeof candidate.url === 'string') {
    return shareableSource({
      url: candidate.url,
      name: typeof candidate.name === 'string' ? candidate.name : undefined,
      title: typeof candidate.title === 'string' ? candidate.title : undefined,
      behaviorHints: {
        filename: typeof candidate.filename === 'string' ? candidate.filename : undefined,
        videoSize: typeof candidate.videoSize === 'number' ? candidate.videoSize : undefined,
      },
    }).source
  }
  return null
}

export function sharedSourceKey(source: SharedSource | null | undefined): string {
  if (!source) return ''
  return source.kind === 'torrent'
    ? `torrent:${source.infoHash}:${source.filename ?? ''}`
    : `http:${source.url}`
}
