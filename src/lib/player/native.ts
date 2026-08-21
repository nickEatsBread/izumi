import { invoke } from '@tauri-apps/api/core'
import { get } from 'svelte/store'
import { getDrmEngine } from './drm'
import { gifCapturePlan } from './gif-settings'
import { nowPlayingStream } from './session'
import { gifMaxSeconds, gifScale } from '$lib/settings/ui'

/** Route player IPC through the in-webview DRM engine when a stream is encrypted. */

function drmStream(): boolean {
  return !!get(nowPlayingStream).drm
}

export function playerCommand(name: string, args: string[] = []): Promise<void> {
  const drm = getDrmEngine()
  if (drm) {
    drm.command(name, args)
    return Promise.resolve()
  }
  if (drmStream()) return Promise.resolve()
  return invoke('player_command', { name, args })
}

export function playerGetProperty(name: string): Promise<string> {
  const drm = getDrmEngine()
  if (drm) return Promise.resolve(drm.getProperty(name))
  if (drmStream()) return Promise.resolve('')
  return invoke<string>('player_get_property', { name })
}

export function playerTracks(): Promise<string> {
  const drm = getDrmEngine()
  if (drm) return Promise.resolve(JSON.stringify(drm.tracks()))
  if (drmStream()) return Promise.resolve('[]')
  return invoke<string>('player_tracks')
}

export async function playerScreenshot(): Promise<void> {
  const drm = getDrmEngine()
  if (drm?.screenshot) {
    await drm.screenshot()
    return
  }
  if (drmStream()) return
  await invoke('player_screenshot')
}

export async function playerGifStart(includeSubtitles: boolean): Promise<void> {
  const drm = getDrmEngine()
  if (drm?.gifStart) {
    await drm.gifStart(includeSubtitles)
    return
  }
  if (drmStream()) throw new Error('DRM GIF capture is unavailable')
}

export async function playerGifStop(range?: { startSec: number; endSec: number }): Promise<void> {
  const drm = getDrmEngine()
  if (drm?.gifStop) {
    await drm.gifStop()
    return
  }
  if (drmStream()) throw new Error('DRM GIF capture is unavailable')
  let start = range?.startSec
  let end = range?.endSec
  if (end == null || !Number.isFinite(end)) {
    const raw = await invoke<string>('player_get_property', { name: 'time-pos' }).catch(() => '')
    end = Number(raw)
  }
  if (start == null || !Number.isFinite(start)) start = Math.max(0, (end ?? 0) - 3)
  if (!Number.isFinite(end) || end <= start) end = start + 0.4
  const plan = gifCapturePlan(get(gifScale), get(gifMaxSeconds))
  const duration = Math.min(plan.maxSeconds, end - start)
  await invoke('player_capture_segment', {
    kind: 'gif',
    startSec: Math.max(0, end - duration),
    endSec: end,
    width: plan.width,
  })
}

/** Safe even when no recorder is active; used during close/source replacement. */
export async function playerGifAbort(): Promise<void> {
  const drm = getDrmEngine()
  if (drm?.gifAbort) {
    await drm.gifAbort()
    return
  }
  if (drmStream()) return
  await invoke('player_gif_abort')
}

export async function playerThumbnail(time: number): Promise<string | null> {
  return (await getDrmEngine()?.thumbnail?.(time)) ?? null
}
