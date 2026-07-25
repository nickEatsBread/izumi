import type { Stream } from '$lib/stremio/parse'

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
      headers?: Record<string, string>
      name?: string
      title?: string
    }

export interface SharedSourceState {
  source: SharedSource | null
  error: string
}

function short(value: string | undefined, limit = 300): string | undefined {
  const clean = value?.trim()
  return clean ? clean.slice(0, limit) : undefined
}

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[?::1\]?)$/i

/**
 * Shape-check a URL for the wire. This is parsing sanity ONLY — it does not scrub credentials.
 * `null` means "not a usable http(s) address", not "unsafe to share".
 */
function wireHttpUrl(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    // A direct-P2P stream resolves to the local torrent engine's loopback address, which is
    // meaningless on any other device — share the infohash for those instead.
    if (LOOPBACK.test(url.hostname)) return null
    return url.toString()
  } catch {
    return null
  }
}

/**
 * Build the source identity that crosses a Watch Together room.
 *
 * This shares the host's source AS-IS, including account-bound debrid links and any request
 * headers they need. Izumi does not redact them: guests play the host's exact URL, which is what
 * makes a room work when they have no debrid account of their own.
 *
 * That means the host's link is streamed from every guest's IP address. Every major debrid
 * provider treats shared links and multi-IP use as account sharing, so hosting a room on debrid
 * is a deliberate choice the host is warned about before the room opens
 * (see `DebridRoomNotice.svelte`) — it is not something this module can make safe.
 *
 * A resolved http(s) URL wins when present; otherwise the torrent identity is shared so the guest
 * can resolve it locally.
 */
export function shareableSource(stream: Stream): SharedSourceState {
  const filename = short(stream.behaviorHints?.filename, 500)
  const videoSize = Number.isFinite(stream.behaviorHints?.videoSize)
    ? Math.max(0, Math.floor(stream.behaviorHints!.videoSize!))
    : undefined
  const name = short(stream.name)
  const title = short(stream.title, 500)

  const url = stream.url ? wireHttpUrl(stream.url) : null
  if (url) {
    const headers = stream.__headers && Object.keys(stream.__headers).length ? { ...stream.__headers } : undefined
    return { source: { version: 1, kind: 'http', url, filename, videoSize, headers, name, title }, error: '' }
  }

  if (stream.infoHash) {
    const infoHash = stream.infoHash.trim().toLowerCase()
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
        name,
        title,
      },
      error: '',
    }
  }

  return { source: null, error: 'The selected source has no shareable torrent or HTTP address.' }
}

export function streamFromSharedSource(source: SharedSource): Stream {
  const behaviorHints = {
    filename: source.filename,
    videoSize: source.videoSize,
    ...(source.kind === 'torrent' && source.bingeGroup ? { bingeGroup: source.bingeGroup } : {}),
  }
  return source.kind === 'torrent'
    ? { infoHash: source.infoHash, name: source.name, title: source.title, behaviorHints }
    : {
        url: source.url,
        name: source.name,
        title: source.title,
        behaviorHints,
        __stream: true,
        ...(source.headers ? { __headers: source.headers } : {}),
      }
}

/** Validate and normalize an untrusted source received from a peer. */
export function parseSharedSource(value: unknown): SharedSource | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<SharedSource> & { headers?: unknown }
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
    // Only string→string header pairs survive the trip; a peer cannot inject objects here.
    let headers: Record<string, string> | undefined
    if (candidate.headers && typeof candidate.headers === 'object' && !Array.isArray(candidate.headers)) {
      const clean: Record<string, string> = {}
      for (const [k, v] of Object.entries(candidate.headers as Record<string, unknown>)) {
        if (typeof v === 'string') clean[k] = v
      }
      if (Object.keys(clean).length) headers = clean
    }
    return shareableSource({
      url: candidate.url,
      __headers: headers,
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
