import { invoke } from '@tauri-apps/api/core'
import { get } from 'svelte/store'
import { isAndroid } from '$lib/platform'
import { torrentAndroidPostSeed } from '$lib/settings/ui'

type AndroidDeviceStatus = { unmetered: boolean; charging: boolean }
export type DirectTorrentHealth = {
  downloadedBytes: number
  selectedSize: number
  downloadMbps: number
  livePeers: number
}

let activePlaybackId: number | null = null
let activePlaybackUrl: string | null = null
let lastBufferLow: boolean | null = null
let streamPrioritized = false

/** Mark the native torrent returned for the stream that is about to enter the player. */
export function activateDirectTorrentPlayback(playbackId: number, url?: string) {
  activePlaybackId = playbackId
  activePlaybackUrl = url ?? null
  lastBufferLow = null
  streamPrioritized = false
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

/** Tell the native engine that a player now owns the HTTP stream, so only player-requested video
 * windows (plus tiny sidecars) should download instead of the entire selected episode. */
export function prioritizeDirectTorrentStream(playbackId: number | null = activePlaybackId) {
  if (playbackId == null) return
  streamPrioritized = true
  void invoke('torrent_playback_streaming', { playbackId }).catch(() => {
    if (activePlaybackId === playbackId) streamPrioritized = false
  })
}

/** FileLoaded is emitted with mpv's actual path. Matching the exact loopback URL proves the new
 * FileStream exists; unlike a generic progress event, it cannot belong to the previous episode. */
export function confirmDirectTorrentFileLoaded(url: string) {
  if (activePlaybackId == null || !activePlaybackUrl || url !== activePlaybackUrl) return
  if (!streamPrioritized) prioritizeDirectTorrentStream(activePlaybackId)
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
    activePlaybackUrl = null
    lastBufferLow = null
    streamPrioritized = false
  }
  const allowPostPlaybackSeed = get(isAndroid)
    ? await androidAllowsPostPlaybackSeed()
    : true
  await invoke('torrent_playback_stop', { playbackId, allowPostPlaybackSeed }).catch(() => {})
}
