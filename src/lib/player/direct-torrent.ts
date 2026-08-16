import { invoke } from '@tauri-apps/api/core'
import { get, writable } from 'svelte/store'
import { isAndroid } from '$lib/platform'
import {
  torrentAndroidPostSeed, torrentBindInterface, torrentDownloadLimitMbps, torrentProxyEnabled,
  torrentProxyUrl, torrentUploadLimitMode, torrentUpstreamCapacityMbps,
} from '$lib/settings/ui'
import { torrentProxyEndpoint } from './torrent-proxy'
import { listenSafe } from '$lib/util/listen'
import { currentResolveTrace, traceResolve } from '$lib/debug/resolve-trace'

/** The network/limit snapshot every native torrent job takes. Single-sourced so streaming and
 * offline downloads cannot drift — above all the proxy kill switch, which THROWS on a bad endpoint
 * rather than quietly falling back to an unproxied connection. */
export function torrentEngineNetworkOptions() {
  return {
    downloadLimitMbps: Math.max(0, Number(get(torrentDownloadLimitMbps)) || 0),
    upstreamCapacityMbps: get(torrentUploadLimitMode) === 'capacity'
      ? Math.max(0.1, Number(get(torrentUpstreamCapacityMbps)) || 0.1)
      : null,
    socksProxyUrl: torrentProxyEndpoint(get(torrentProxyEnabled), get(torrentProxyUrl)),
    bindInterface: get(torrentBindInterface).trim() || null,
  }
}

export type NetInterfaceInfo = {
  name: string
  label: string
  ips: string[]
  isUp: boolean
  isVpnLike: boolean
  isDefaultRoute: boolean
}

/** Adapters for the Settings → Network binding dropdown, VPN-looking ones first. */
export async function listNetworkInterfaces(): Promise<NetInterfaceInfo[]> {
  return await invoke<NetInterfaceInfo[]>('list_network_interfaces')
}

/** Kill-switch state toast: without it, a VPN drop reads as "the source died" — playback just
 * stalls while the native engine quietly holds every torrent until the adapter returns. */
export const torrentVpnNotice = writable('')
let vpnNoticeTimer: ReturnType<typeof setTimeout> | undefined

function vpnNotify(text: string) {
  torrentVpnNotice.set(text)
  clearTimeout(vpnNoticeTimer)
  vpnNoticeTimer = setTimeout(() => torrentVpnNotice.set(''), 6000)
}

export function initTorrentVpnToasts(): () => void {
  const unDown = listenSafe<string>('torrent-vpn-down', (event) =>
    vpnNotify(`VPN disconnected — torrenting is paused until ${event.payload} returns`))
  const unUp = listenSafe<string>('torrent-vpn-up', (event) =>
    vpnNotify(`VPN reconnected — torrenting resumed on ${event.payload}`))
  const unStream = listenSafe<{
    playbackId: number
    fileIndex: number
    requestRange: string | null
  }>('direct-torrent-stream-started', (event) => {
    if (event.payload.playbackId !== activePlaybackId) return
    traceResolve(currentResolveTrace(), 'direct P2P first player HTTP request', event.payload)
  })
  return () => { unDown(); unUp(); unStream() }
}

type AndroidDeviceStatus = { unmetered: boolean; charging: boolean }
export type DirectTorrentHealth = {
  downloadedBytes: number
  selectedSize: number
  downloadMbps: number
  livePeers: number
  // Diagnostics — surfaced by the player's stats overlay, not used by the watchdog.
  uploadMbps: number
  queuedPeers: number
  connectingPeers: number
  deadPeers: number
  notNeededPeers: number
  seenPeers: number
  fetchedBytes: number
  state: string
  finished: boolean
  error: string | null
  // Last localhost request mpv made. These prove whether a probe was truly range-limited.
  streamRequestCount: number
  streamFileIndex: number | null
  streamRequestRange: string | null
  streamStatus: number | null
  streamResponseBytes: number | null
  streamRangeStart: number | null
  /** Exclusive end, matching Rust's parsed range. */
  streamRangeEnd: number | null
  streamFirstByteMs: number | null
  streamBytesServed: number
  streamReadFinished: boolean
  streamReadFailed: boolean
  nextPreloadFileIndex: number | null
  nextPreloadDownloadedBytes: number
  nextPreloadSize: number
}

export type DirectTorrentNextPreload = {
  fileIndex: number
  filename: string
  size: number
  downloadedBytes: number
  sameTorrent: boolean
}

let activePlaybackId: number | null = null
let lastBufferLow: boolean | null = null
let startupSequence = 0
let lastHealthTraceAt = 0

/** Monotonic within this webview. The native side uses equality, not ordering, so a hot reload that
 * resets the counter is still safe: a newly stored id supersedes the old request atomically. */
export function nextDirectTorrentStartupId(): number {
  startupSequence = startupSequence >= Number.MAX_SAFE_INTEGER ? 1 : startupSequence + 1
  return startupSequence
}

/** Mark the native torrent returned for the stream that is about to enter the player. */
export function activateDirectTorrentPlayback(playbackId: number) {
  activePlaybackId = playbackId
  lastBufferLow = null
  lastHealthTraceAt = 0
}

export function currentDirectTorrentPlaybackId(): number | null {
  return activePlaybackId
}

/** Widen the active season-pack selection and prioritize the next file without replacing the
 * episode mpv is reading. The native side rejects different infohashes and stale playback ids. */
export async function prepareDirectTorrentNext(input: {
  infoHash: string
  magnet?: string
  preferredFilename?: string
  seriesTitle: string
  episode: number
  absoluteEpisode?: number
  season?: number
}): Promise<DirectTorrentNextPreload | null> {
  const playbackId = activePlaybackId
  if (playbackId == null) return null
  return await invoke<DirectTorrentNextPreload>('torrent_playback_prepare_next', {
    playbackId,
    infoHash: input.infoHash,
    magnet: input.magnet,
    preferredFilename: input.preferredFilename,
    seriesTitle: input.seriesTitle,
    episode: input.episode,
    absoluteEpisode: input.absoluteEpisode,
    season: input.season,
  })
}

/** Safety fallback after the player has produced a frame. The native HTTP-request notification is
 * the normal handoff; calling this when player_embed merely accepts a URL is too early. */
export async function directTorrentPlayerAttached(playbackId: number) {
  await invoke('torrent_playback_player_attached', { playbackId }).catch(() => {})
}

/** Cancel metadata/initialization work that has not produced a playback id yet. Starting another
 * torrent also supersedes the previous generation natively; this explicit command covers Back and
 * Cancel, where there may be no replacement invoke to do that for us. */
export async function cancelDirectTorrentStartup(startupId: number) {
  await invoke('torrent_playback_cancel_start', { startupId }).catch(() => {})
}

/** Read native download progress for startup/recovery liveness checks. */
export async function directTorrentHealth(): Promise<DirectTorrentHealth | null> {
  const playbackId = activePlaybackId
  if (playbackId == null) return null
  const health = await invoke<DirectTorrentHealth>('torrent_playback_health', { playbackId }).catch(() => null)
  if (health && activePlaybackId === playbackId) {
    const now = performance.now()
    // Two independent watchdogs can poll during startup. Keep the useful one-second timeline
    // without printing the same native snapshot twice in one tick.
    if (now - lastHealthTraceAt >= 900) {
      lastHealthTraceAt = now
      // Persist numeric delivery evidence in release diagnostics too. Omit the raw Range header
      // and native error text; those are useful in the developer console but not needed to tell
      // player rejection from local-server starvation.
      const safeHealth = import.meta.env.DEV ? health : {
        downloadedBytes: health.downloadedBytes,
        selectedSize: health.selectedSize,
        downloadMbps: health.downloadMbps,
        livePeers: health.livePeers,
        fetchedBytes: health.fetchedBytes,
        streamRequestCount: health.streamRequestCount,
        streamFileIndex: health.streamFileIndex,
        streamStatus: health.streamStatus,
        streamResponseBytes: health.streamResponseBytes,
        streamRangeStart: health.streamRangeStart,
        streamRangeEnd: health.streamRangeEnd,
        streamFirstByteMs: health.streamFirstByteMs,
        streamBytesServed: health.streamBytesServed,
        streamReadFinished: health.streamReadFinished,
        streamReadFailed: health.streamReadFailed,
      }
      traceResolve(currentResolveTrace(), 'direct P2P health', { playbackId, ...safeHealth })
    }
  }
  return health
}

/** Feed mpv's buffered end timestamp into the native upload governor. Only threshold changes cross
 * the bridge, so frequent player progress events do not become frequent native commands. */
export function reportDirectTorrentBuffer(position: number, bufferedEnd: number) {
  const playbackId = activePlaybackId
  if (playbackId == null) return
  const bufferedSeconds = Math.max(0, bufferedEnd - position)
  const low = bufferedSeconds < 60
  if (low === lastBufferLow) return
  lastBufferLow = low
  invoke('torrent_playback_buffer', { playbackId, bufferedSeconds }).catch(() => {
    // A rejected bridge call did not update the native governor. Allow the next progress event to
    // retry this threshold, but do not roll back a newer threshold or a newer playback session.
    if (activePlaybackId === playbackId && lastBufferLow === low) lastBufferLow = null
  })
}

async function androidAllowsPostPlaybackSeed(): Promise<boolean> {
  if (!get(torrentAndroidPostSeed)) return false
  try {
    const status = await invoke<AndroidDeviceStatus>('plugin:extplayer|device_status')
    return status.unmetered && status.charging
  } catch {
    // Failure is conservative: never leave a mobile torrent running when eligibility is unknown.
    return false
  }
}

/** Close the current direct-playback session. A captured id may be supplied by an external-player
 * return/exit callback; the backend also rejects stale ids, so it cannot stop a newer episode. */
export async function stopDirectTorrentPlayback(playbackId: number | null = activePlaybackId) {
  if (playbackId == null) return
  if (activePlaybackId === playbackId) {
    activePlaybackId = null
    lastBufferLow = null
  }
  const allowPostPlaybackSeed = get(isAndroid)
    ? await androidAllowsPostPlaybackSeed()
    : true
  await invoke('torrent_playback_stop', { playbackId, allowPostPlaybackSeed }).catch(() => {})
}

/** Abandon a torrent that never reached playback. Unlike a normal stop, this must not leave a
 * background seeding session behind: the user canceled it or a better source superseded it. */
export async function discardDirectTorrentPlayback(playbackId: number) {
  if (activePlaybackId === playbackId) {
    activePlaybackId = null
    lastBufferLow = null
  }
  await invoke('torrent_playback_stop', { playbackId, allowPostPlaybackSeed: false }).catch(() => {})
}
