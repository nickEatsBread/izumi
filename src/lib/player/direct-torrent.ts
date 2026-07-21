import { invoke } from '@tauri-apps/api/core'
import { get } from 'svelte/store'
import { isAndroid } from '$lib/platform'
import { torrentAndroidPostSeed } from '$lib/settings/ui'

type AndroidDeviceStatus = { unmetered: boolean; charging: boolean }

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

/** Feed mpv's buffered end timestamp into the native upload governor. Only threshold changes cross
 * the bridge, so frequent player progress events do not become frequent native commands. */
export function reportDirectTorrentBuffer(position: number, bufferedEnd: number) {
  const playbackId = activePlaybackId
  if (playbackId == null) return
  const bufferedSeconds = Math.max(0, bufferedEnd - position)
  const low = bufferedSeconds < 60
  if (low === lastBufferLow) return
  lastBufferLow = low
  invoke('torrent_playback_buffer', { playbackId, bufferedSeconds }).catch(() => {})
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
