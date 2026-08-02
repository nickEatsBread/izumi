import { invoke } from '@tauri-apps/api/core'
import { get } from 'svelte/store'
import { isAndroid } from '$lib/platform'
import {
  torrentAndroidPostSeed, torrentDownloadLimitMbps, torrentProxyEnabled, torrentProxyUrl,
  torrentUploadLimitMode, torrentUpstreamCapacityMbps,
} from '$lib/settings/ui'
import { torrentProxyEndpoint } from './torrent-proxy'

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
  }
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
