import { invoke } from '@tauri-apps/api/core'
import { addPluginListener, type PluginListener } from '@tauri-apps/api/core'
import { writable, get } from 'svelte/store'

// Embedded libmpv player on Android (the "full" flavor). The plugin (plugin:mpv|*) only exists
// when the app was built with the `android-mpv` Cargo feature; on the "lite" flavor these invokes
// reject and we fall back to the external-player intent.

export interface MpvLoad {
  url: string
  title?: string
  startPos?: number
  subtitles?: string[]
}

/** True while the embedded player overlay is showing (drives the transparent hole + AndroidPlayer). */
export const androidMpvActive = writable(false)

/** Live playback state, fed by the single mpv event subscription. Read by AndroidPlayer + tracking. */
export const mpvState = writable<{
  pos: number
  dur: number
  paused: boolean
  eof: boolean
  buffering: boolean
  cacheEnd: number
}>({
  pos: 0,
  dur: 0,
  paused: false,
  eof: false,
  buffering: false,
  cacheEnd: 0,
})

// Android resolves mpv_command as soon as libmpv has QUEUED it, before the matching time-pos event.
// Keep ignoring older observations until that acknowledgement arrives, otherwise a stale event can
// snap the UI back and make the next relative seek use the wrong starting position.
let pendingSeekTarget: number | null = null
let seekGeneration = 0
let pendingSeekTimer: ReturnType<typeof setTimeout> | undefined

function clearPendingSeek(generation?: number) {
  if (generation != null && generation !== seekGeneration) return
  pendingSeekTarget = null
  clearTimeout(pendingSeekTimer)
  pendingSeekTimer = undefined
}

let embeddedChecked: boolean | undefined
/** Whether the embedded-player plugin is compiled in (full flavor). Cached after first probe. */
export async function hasEmbeddedPlayer(): Promise<boolean> {
  if (embeddedChecked !== undefined) return embeddedChecked
  try {
    await invoke('plugin:mpv|mpv_get', { payload: { property: 'idle-active' } })
    embeddedChecked = true
  } catch {
    embeddedChecked = false
  }
  return embeddedChecked
}

let progressSub: PluginListener | undefined
/** Start the single observed-property subscription that keeps `mpvState` current. Idempotent;
 *  lives for the app session (the plugin core is recreated per play, the JS listener persists). */
export async function startMpvEvents(): Promise<void> {
  if (progressSub) return
  progressSub = await addPluginListener('mpv', 'progress', (e: unknown) => {
    const { property, value } = e as { property: string; value: unknown }
    mpvState.update((s) => {
      if (property === 'time-pos' && typeof value === 'number') {
        if (pendingSeekTarget != null) {
          if (Math.abs(value - pendingSeekTarget) <= 2.5) clearPendingSeek()
          else return s
        }
        return { ...s, pos: value }
      }
      if (property === 'duration' && typeof value === 'number') return { ...s, dur: value }
      if (property === 'pause' && typeof value === 'boolean') return { ...s, paused: value }
      if (property === 'eof-reached') return { ...s, eof: value === true }
      if (property === 'paused-for-cache') return { ...s, buffering: value === true }
      if (property === 'demuxer-cache-time' && typeof value === 'number') return { ...s, cacheEnd: value }
      return s
    })
  })
}

export async function mpvLoad(p: MpvLoad): Promise<void> {
  seekGeneration++
  clearPendingSeek()
  // Reset UI state for the new file (fresh time-pos/duration events will repopulate it).
  // buffering starts true — the spinner shows until the first frame's duration/time-pos lands.
  mpvState.set({ pos: 0, dur: 0, paused: false, eof: false, buffering: true, cacheEnd: 0 })
  await invoke('plugin:mpv|mpv_load', {
    payload: {
      url: p.url,
      title: p.title ?? null,
      startPos: p.startPos ?? 0,
      subtitles: p.subtitles ?? [],
    },
  })
}

export async function mpvCommand(args: string[]): Promise<void> {
  await invoke('plugin:mpv|mpv_command', { payload: { args } })
}

export async function mpvGet(property: string): Promise<string | null> {
  try {
    const r = (await invoke('plugin:mpv|mpv_get', { payload: { property } })) as { value: string | null }
    return r?.value ?? null
  } catch {
    return null
  }
}

export async function mpvStop(): Promise<void> {
  await invoke('plugin:mpv|mpv_stop')
  seekGeneration++
  clearPendingSeek()
  mpvState.set({ pos: 0, dur: 0, paused: false, eof: false, buffering: false, cacheEnd: 0 })
  androidStreamInfo.set(null)
}

/** Enter Android picture-in-picture. Video keeps rendering into the SurfaceView in the PIP window. */
export const mpvPip = () => invoke('plugin:mpv|mpv_pip')

/**
 * Align the native video surface with the WebView player shell. A zero height restores full-screen.
 * Coordinates are physical Android pixels, not CSS pixels.
 */
export interface PlayerViewportInsets {
  top: number
  right: number
  bottom: number
  left: number
}

export async function setPlayerViewport(
  top: number,
  height: number,
  immersive: boolean,
): Promise<PlayerViewportInsets> {
  return (await invoke('plugin:mpv|mpv_viewport', {
    payload: { top: Math.round(top), height: Math.round(height), immersive },
  })) as PlayerViewportInsets
}

/** Enter/exit the Android landscape player. Exit briefly requests portrait, then restores sensor rotation. */
export const setPlayerFullscreen = (enabled: boolean) =>
  invoke('plugin:mpv|mpv_fullscreen', { payload: { enabled } })

/**
 * Live-scale/translate the native video surface for the portrait pull-to-fullscreen gesture — the
 * video keeps playing and zooms as one unit (a view compositor transform, not a surface resize).
 * `scale` is unitless (1 = resting 16:9); `translateY` is physical pixels (negative = up). Any
 * `setPlayerViewport` call resets this back to identity.
 */
export const setPlayerTransform = (scale: number, translateY: number) =>
  invoke('plugin:mpv|mpv_transform', { payload: { scale, translateY } })

/** mpv chapter marker times (seconds), via sub-property paths. Empty when the file has no chapters. */
export async function getChapters(): Promise<number[]> {
  const count = Number(await mpvGet('chapter-list/count')) || 0
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    const t = Number(await mpvGet(`chapter-list/${i}/time`))
    if (isFinite(t) && t > 0) out.push(t)
  }
  return out
}

// --- Track selection (audio / subtitles) ---
export interface MpvTrack {
  id: number
  type: 'video' | 'audio' | 'sub'
  title?: string
  lang?: string
  selected: boolean
}

/** Read mpv's track-list via sub-property paths — get_property_string on the whole node returns
 *  only the count, not JSON, so we walk track-list/N/<field> which return proper string values. */
export async function getTracks(): Promise<MpvTrack[]> {
  const count = Number(await mpvGet('track-list/count')) || 0
  const out: MpvTrack[] = []
  for (let i = 0; i < count; i++) {
    const type = await mpvGet(`track-list/${i}/type`)
    if (type !== 'audio' && type !== 'sub' && type !== 'video') continue
    out.push({
      id: Number(await mpvGet(`track-list/${i}/id`)),
      type,
      title: (await mpvGet(`track-list/${i}/title`)) || undefined,
      lang: (await mpvGet(`track-list/${i}/lang`)) || undefined,
      selected: (await mpvGet(`track-list/${i}/selected`)) === 'yes',
    })
  }
  return out
}

export const setAudioTrack = (id: number) => mpvCommand(['set', 'aid', String(id)])
/** Pass a track id, or 'no' to turn subtitles off. */
export const setSubTrack = (id: number | 'no') => mpvCommand(['set', 'sid', String(id)])

// --- Control helpers ---
export const togglePause = () => mpvCommand(['cycle', 'pause'])
export const setPaused = (paused: boolean) => mpvCommand(['set', 'pause', paused ? 'yes' : 'no'])
/** Precise seek — `+exact` avoids the keyframe snap that made taps/scrubs feel imprecise. */
function requestExactSeek(sec: number) {
  let target = Math.max(0, sec)
  mpvState.update((s) => {
    target = s.dur > 0 ? Math.min(s.dur, target) : target
    return { ...s, pos: target }
  })
  const generation = ++seekGeneration
  clearTimeout(pendingSeekTimer)
  pendingSeekTarget = target
  return mpvCommand(['seek', target.toFixed(3), 'absolute+exact']).then(() => {
    if (generation !== seekGeneration || pendingSeekTarget == null) return
    // A failed/missing native observation must not pin the optimistic position forever. Reconcile
    // after a generous window; normal seeks clear this from their time-pos event almost instantly.
    pendingSeekTimer = setTimeout(async () => {
      if (generation !== seekGeneration || pendingSeekTarget == null) return
      const rawActual = await mpvGet('time-pos')
      const actual = rawActual == null ? Number.NaN : Number(rawActual)
      if (generation !== seekGeneration) return
      clearPendingSeek(generation)
      if (Number.isFinite(actual)) mpvState.update((s) => ({ ...s, pos: actual }))
    }, 2000)
  }).catch((error) => {
    clearPendingSeek(generation)
    throw error
  })
}

export const seekAbsolute = (sec: number) => requestExactSeek(sec)
/** Fast, inexact seek for live scrub preview (snaps to keyframes, cheap on network streams). */
export const seekKeyframe = (sec: number) => mpvCommand(['seek', sec.toFixed(3), 'absolute+keyframes'])
export function seekRelative(delta: number) {
  let target = 0
  const state = get(mpvState)
  target = Math.max(0, state.pos + delta)
  if (state.dur > 0) target = Math.min(state.dur, target)
  return requestExactSeek(target)
}
export const setSpeed = (v: number) => mpvCommand(['set', 'speed', String(v)])
/** mpv software volume, 0..100 (clamped). */
export const setVolume = (v: number) => mpvCommand(['set', 'volume', String(Math.max(0, Math.min(100, Math.round(v))))])
export const getVolume = async () => Number(await mpvGet('volume')) || 0

// --- Native touch extras (embedded full flavor only; reject → caught no-op on lite) ---
/** Screen brightness 0..1, or -1 to restore system/auto brightness. */
export const setBrightness = (value: number) =>
  invoke('plugin:mpv|mpv_brightness', { payload: { value } }).catch(() => {})
/** Short haptic pulse (ms). */
export const haptic = (ms: number) => invoke('plugin:mpv|mpv_haptic', { payload: { ms } }).catch(() => {})

/** Current Android stream URL + headers, for the thumbnail frame source. Null when idle. */
export const androidStreamInfo = writable<{ url: string; headers: Record<string, string> } | null>(null)

/** Grab a preview frame (data URL) at `timeSec`, or null if this stream can't produce one. */
export async function grabThumb(timeSec: number, width = 320): Promise<string | null> {
  const info = get(androidStreamInfo)
  if (!info) return null
  try {
    const r = (await invoke('plugin:mpv|mpv_thumb', {
      payload: { url: info.url, headers: info.headers, timeSec, width },
    })) as { value: string | null }
    return r?.value ?? null
  } catch {
    return null
  }
}
