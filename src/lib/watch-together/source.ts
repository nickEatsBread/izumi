import type { Stream } from '$lib/stremio/parse'
import { parseStreamDrm, type StreamDrm } from '$lib/player/drm'
import { invoke } from '@tauri-apps/api/core'
import { isLoopbackHttpUrl, replaceLoopbackHost } from '$lib/player/stream-address'

type SharedSubtitle = NonNullable<Stream['__subtitles']>[number]
type SharedAudioTrack = NonNullable<Stream['__audioTracks']>[number]

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
      drm?: StreamDrm
      subtitles?: SharedSubtitle[]
      audioTracks?: SharedAudioTrack[]
      previewUrl?: string
      audioLang?: string
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
    if (isLoopbackHttpUrl(url.toString())) return null
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
export function shareableSource(stream: Stream, lanHost?: string): SharedSourceState {
  let playback = stream.__party ? { ...stream, ...stream.__party, __party: undefined } : stream
  // A provider-supplied party source is already its own capability-scoped host route. The fallback
  // below is ONLY for the JVM HttpServer marker: upstream binds it to all interfaces but returns a
  // localhost URL. Never expose an arbitrary Izumi loopback proxy or the Direct P2P engine.
  if (!stream.__party && stream.__hosted && !stream.infoHash && lanHost && isLoopbackHttpUrl(playback.url)) {
    const route = (value: string | undefined) => replaceLoopbackHost(value, lanHost)
    playback = {
      ...playback,
      url: route(playback.url),
      __drm: playback.__drm ? {
        ...playback.__drm,
        licenseUrl: route(playback.__drm.licenseUrl),
        releaseUrl: route(playback.__drm.releaseUrl),
        refreshUrl: route(playback.__drm.refreshUrl),
        serverCertificateUrl: route(playback.__drm.serverCertificateUrl),
      } : undefined,
      __subtitles: playback.__subtitles?.map((track) => ({
        ...track,
        url: route(track.url) ?? track.url,
        switchUrl: route(track.switchUrl),
      })),
      __audioTracks: playback.__audioTracks?.map((track) => ({
        ...track,
        url: route(track.url),
        switchUrl: route(track.switchUrl),
      })),
      __previewUrl: route(playback.__previewUrl),
    }
  }
  const filename = short(stream.behaviorHints?.filename, 500)
  const videoSize = Number.isFinite(stream.behaviorHints?.videoSize)
    ? Math.max(0, Math.floor(stream.behaviorHints!.videoSize!))
    : undefined
  const name = short(stream.name)
  const title = short(stream.title, 500)

  const url = playback.url ? wireHttpUrl(playback.url) : null
  if (url) {
    const headers = playback.__headers && Object.keys(playback.__headers).length ? { ...playback.__headers } : undefined
    return {
      source: {
        version: 1, kind: 'http', url, filename, videoSize, headers, name, title,
        drm: playback.__drm,
        subtitles: playback.__subtitles,
        audioTracks: playback.__audioTracks,
        previewUrl: playback.__previewUrl,
        audioLang: playback.__audioLang,
      },
      error: '',
    }
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

export interface WatchPartyNetworkInterface {
  ips: string[]
  isUp: boolean
  isVpnLike: boolean
  isDefaultRoute: boolean
}

function ipv4Class(value: string): number | null {
  const parts = value.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null
  const [a, b] = parts
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 0
  if (a === 100 && b >= 64 && b <= 127) return 1 // Tailscale/other CGNAT overlays
  if (a === 127 || a === 0 || (a === 169 && b === 254) || a >= 224) return null
  return 2
}

/** Prefer an ordinary private LAN over VPN/overlay/public adapters. The JVM server is wildcard-
 * bound, so the chosen address only changes how the guest reaches the same host process. */
export function selectWatchPartyLanHost(interfaces: WatchPartyNetworkInterface[]): string | undefined {
  return interfaces
    .filter((iface) => iface.isUp)
    .flatMap((iface) => iface.ips.flatMap((ip) => {
      const addressClass = ipv4Class(ip)
      return addressClass == null ? [] : [{ ip, iface, addressClass }]
    }))
    .sort((left, right) =>
      left.addressClass - right.addressClass
      || Number(left.iface.isVpnLike) - Number(right.iface.isVpnLike)
      || Number(right.iface.isDefaultRoute) - Number(left.iface.isDefaultRoute),
    )[0]?.ip
}

/** Resolve the only source form that cannot be serialized synchronously: a wildcard-bound JVM
 * localhost server. Remote URLs, torrents, and provider capability routes take no native hop. */
export async function shareableSourceForDevice(stream: Stream): Promise<SharedSourceState> {
  const direct = shareableSource(stream)
  if (direct.source || !stream.__hosted || stream.infoHash || !isLoopbackHttpUrl(stream.url)) return direct
  try {
    const interfaces = await invoke<WatchPartyNetworkInterface[]>('list_network_interfaces')
    const lanHost = selectWatchPartyLanHost(interfaces)
    if (lanHost) return shareableSource(stream, lanHost)
  } catch { /* surface one stable source error below */ }
  return {
    source: null,
    error: 'The host provider stream is local and no reachable LAN address is available.',
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
    : {
        url: source.url,
        name: source.name,
        title: source.title,
        behaviorHints,
        __stream: true,
        ...(source.headers ? { __headers: source.headers } : {}),
        ...(source.drm ? { __drm: source.drm } : {}),
        ...(source.subtitles ? { __subtitles: source.subtitles } : {}),
        ...(source.audioTracks ? { __audioTracks: source.audioTracks } : {}),
        ...(source.previewUrl ? { __previewUrl: source.previewUrl } : {}),
        ...(source.audioLang ? { __audioLang: source.audioLang } : {}),
      }
}

/** Validate and normalize an untrusted source received from a peer. */
export function parseSharedSource(value: unknown): SharedSource | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<SharedSource> & {
    headers?: unknown
    drm?: unknown
    subtitles?: unknown
    audioTracks?: unknown
  }
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
    const cleanUrl = (raw: unknown) => typeof raw === 'string' ? wireHttpUrl(raw) ?? undefined : undefined
    const subtitles = Array.isArray(candidate.subtitles)
      ? candidate.subtitles.slice(0, 100).flatMap((raw): SharedSubtitle[] => {
          if (!raw || typeof raw !== 'object') return []
          const track = raw as Record<string, unknown>
          const url = cleanUrl(track.url)
          if (!url) return []
          return [{
            url,
            lang: short(typeof track.lang === 'string' ? track.lang : undefined, 40),
            title: short(typeof track.title === 'string' ? track.title : undefined, 200),
            isDefault: track.isDefault === true,
            kind: track.kind === 'captions' ? 'captions' : 'subtitles',
            switchUrl: cleanUrl(track.switchUrl),
          }]
        })
      : undefined
    const audioTracks = Array.isArray(candidate.audioTracks)
      ? candidate.audioTracks.slice(0, 50).flatMap((raw): SharedAudioTrack[] => {
          if (!raw || typeof raw !== 'object') return []
          const track = raw as Record<string, unknown>
          const url = cleanUrl(track.url)
          const switchUrl = cleanUrl(track.switchUrl)
          if (!url && !switchUrl) return []
          return [{
            url,
            switchUrl,
            lang: short(typeof track.lang === 'string' ? track.lang : undefined, 40),
            title: short(typeof track.title === 'string' ? track.title : undefined, 200),
          }]
        })
      : undefined
    const drm = parseStreamDrm(candidate.drm)
    if (drm && (
      !drm.licenseUrl
      || !wireHttpUrl(drm.licenseUrl)
      || (drm.releaseUrl && !wireHttpUrl(drm.releaseUrl))
      || (drm.refreshUrl && !wireHttpUrl(drm.refreshUrl))
      || (drm.serverCertificateUrl && !wireHttpUrl(drm.serverCertificateUrl))
    )) return null
    return shareableSource({
      url: candidate.url,
      __headers: headers,
      name: typeof candidate.name === 'string' ? candidate.name : undefined,
      title: typeof candidate.title === 'string' ? candidate.title : undefined,
      __drm: drm,
      __subtitles: subtitles,
      __audioTracks: audioTracks,
      __previewUrl: cleanUrl(candidate.previewUrl),
      __audioLang: short(typeof candidate.audioLang === 'string' ? candidate.audioLang : undefined, 40),
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
