/** The startup animation a pack can set (Rust `startup_animation`): one short video played
 *  full-screen while izumi starts. `app.html` reads the two keys below before any script loads, so
 *  the window paints black instead of flashing Home first. */
import { invoke } from '@tauri-apps/api/core'
import { persisted } from 'svelte-persisted-store'
import { get, writable } from 'svelte/store'

export interface StartupAnimationInfo {
  mime: string
  bytes: number
  sha256: string
  /** `pack:<id>` */
  by: string
}

export interface StartupVideo {
  url: string
  sha256: string
  bytes: number
}

/** Keep in sync with the inline script in `src/app.html`. */
export const STARTUP_INFO_KEY = 'startup-animation-info-v1'
export const STARTUP_ENABLED_KEY = 'startup-animation-enabled-v1'
export const STARTUP_PLAYED_KEY = 'startup-animation-played'
/** Class `app.html` puts on <html> to paint black until the animation is on screen. */
export const STARTUP_COVER_CLASS = 'startup-cover'
/** The animation never holds the app for longer than this. */
export const STARTUP_MAX_MS = 15_000

export const startupAnimationInfo = persisted<StartupAnimationInfo | null>(STARTUP_INFO_KEY, null)
export const startupAnimationEnabled = persisted<boolean>(STARTUP_ENABLED_KEY, true)
/** Bumped to play the animation now, outside a launch (right after a pack is set up). */
export const startupAnimationRequest = writable(0)

export async function setStartupAnimation(video: StartupVideo, by: string): Promise<StartupAnimationInfo> {
  const info = await invoke<StartupAnimationInfo>('startup_animation_set', { ...video, by })
  startupAnimationInfo.set(info)
  return info
}

/** Removes the animation; with `by`, only if that pack set it. */
export async function clearStartupAnimation(by?: string): Promise<void> {
  await invoke('startup_animation_clear', { by: by ?? null })
  await syncStartupAnimationInfo()
}

/** Re-reads what Rust holds, in case the data folder changed under the cached copy. */
export async function syncStartupAnimationInfo(): Promise<StartupAnimationInfo | null> {
  try {
    const info = await invoke<StartupAnimationInfo | null>('startup_animation_info')
    startupAnimationInfo.set(info)
    return info
  } catch {
    return get(startupAnimationInfo)
  }
}

/** A blob URL for the video, or null when there is none. The caller revokes it. */
export async function startupAnimationUrl(): Promise<string | null> {
  const info = get(startupAnimationInfo)
  if (!info) return null
  try {
    const bytes = await invoke<ArrayBuffer>('startup_animation_bytes')
    return URL.createObjectURL(new Blob([bytes], { type: info.mime }))
  } catch {
    return null
  }
}

export function playStartupAnimationNow(): void {
  startupAnimationRequest.update((n) => n + 1)
}

/** Whether a cold launch plays the animation: one is set, it is on, motion is not reduced, and this
 *  webview session has not played it yet (a reload does not replay it). */
export function playsAtLaunch(env: {
  info: StartupAnimationInfo | null
  enabled: boolean
  reducedMotion: boolean
  playedThisSession: boolean
}): boolean {
  return !!env.info && env.enabled && !env.reducedMotion && !env.playedThisSession
}
