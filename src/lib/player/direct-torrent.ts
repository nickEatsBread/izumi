import { invoke } from '@tauri-apps/api/core'
import { get, writable } from 'svelte/store'
import { isAndroid } from '$lib/platform'
import {
  torrentAndroidPostSeed, torrentBindInterface, torrentDownloadLimitMbps, torrentProxyEnabled,
  torrentProxyUrl, torrentUploadLimitMode, torrentUpstreamCapacityMbps,
} from '$lib/settings/ui'
import { torrentProxyEndpoint } from './torrent-proxy'
import { listenSafe } from '$lib/util/listen'

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
  return () => { unDown(); unUp() }
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
}

let activePlaybackId: number | null = null
let lastBufferLow: boolean | null = null

/** Mark the native torrent returned for the stream that is about to enter the player. */
export function activateDirectTorrentPlayback(playbackId: number) {
  activePlaybackId = playbackId
  lastBufferLow = null
}

export function currentDirectTorrentPlaybackId(): number | null {
  return activePlaybackId
}

/** Read native download progress for startup/recovery liveness checks. */
export async function directTorrentHealth(): Promise<DirectTorrentHealth | null> {
  const playbackId = activePlaybackId
  if (playbackId == null) return null
  return await invoke<DirectTorrentHealth>('torrent_playback_health', { playbackId }).catch(() => null)
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
