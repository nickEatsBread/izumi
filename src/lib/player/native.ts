import { invoke } from '@tauri-apps/api/core'
import { get } from 'svelte/store'
import { getDrmEngine } from './drm'
import { gifCapturePlan } from './gif-settings'
import { nowPlayingStream } from './session'
import { gifMaxSeconds, gifScale } from '$lib/settings/ui'
import { setDolbyPlaybackSpeed } from './dolby'

/** Route player IPC through the in-webview DRM engine when a stream is encrypted. */

function drmStream(): boolean {
  return !!get(nowPlayingStream).drm
}

export async function playerCommand(name: string, args: string[] = []): Promise<void> {
  const drm = getDrmEngine()
  if (drm) {
    drm.command(name, args)
    return
  }
  if (drmStream()) return
  const speed = name === 'set' && args[0] === 'speed' ? Number(args[1]) : null
  if (speed != null && speed !== 1) await setDolbyPlaybackSpeed(speed)
  await invoke('player_command', { name, args })
  if (speed === 1) await setDolbyPlaybackSpeed(speed)
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

export async function playerScreenshot(fast = false): Promise<void> {
  const drm = getDrmEngine()
  if (drm?.screenshot) {
    await drm.screenshot(fast)
    return
  }
  if (drmStream()) return
  await invoke('player_screenshot')
}

function jpegBytesToDataUrl(value: unknown): string | null {
  const bytes = value instanceof Uint8Array
    ? value
    : Array.isArray(value) ? Uint8Array.from(value as number[]) : null
  if (!bytes?.length) return null
  // Avoid spreading a full HD JPEG into one function call (and its argument limit).
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return `data:image/jpeg;base64,${btoa(binary)}`
}

/** Exact current frame used as the non-destructive background of the subtitle editor. */
export async function playerEditorSnapshot(time: number): Promise<string | null> {
  const drm = getDrmEngine()
  if (drm?.thumbnail) return drm.thumbnail(time)
  if (drmStream()) return null
  try { return jpegBytesToDataUrl(await invoke('player_editor_snapshot')) }
  catch { return null }
}

export async function playerGifStart(includeSubtitles: boolean, fast = false): Promise<void> {
  const drm = getDrmEngine()
  if (drm?.gifStart) {
    await drm.gifStart(includeSubtitles, fast)
    return
  }
  if (drmStream()) throw new Error('DRM GIF capture is unavailable')
  const plan = gifCapturePlan(get(gifScale), get(gifMaxSeconds))
  await invoke('player_gif_start', {
    includeSubtitles,
    fps: plan.fps,
    width: plan.width,
    maxSeconds: plan.maxSeconds,
  })
}

/** Stop recording. `true` means encoding continues natively in the background. */
export async function playerGifStop(_range?: { startSec?: number; endSec?: number }): Promise<boolean> {
  const drm = getDrmEngine()
  if (drm?.gifStop) {
    await drm.gifStop()
    return true
  }
  if (drmStream()) throw new Error('DRM GIF capture is unavailable')
  await invoke('player_gif_stop')
  return false
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
