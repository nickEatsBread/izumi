import { invoke } from '@tauri-apps/api/core'
import { addPluginListener, type PluginListener } from '@tauri-apps/api/core'
import { writable, get } from 'svelte/store'
import { currentResolveTrace, traceResolve } from '$lib/debug/resolve-trace'

// Embedded libmpv player on Android (the "full" flavor). The plugin (plugin:mpv|*) only exists
// when the app was built with the `android-mpv` Cargo feature; on the "lite" flavor these invokes
// reject and we fall back to the external-player intent.

export interface MpvLoad {
  url: string
  title?: string
  startPos?: number
  subtitles?: {
    url: string
    title?: string
    lang?: string
    selected?: boolean
  }[]
  alang?: string
  slang?: string
  headers?: Record<string, string>
  autoplay?: boolean
}

/** True while the embedded player overlay is showing (drives the transparent hole + AndroidPlayer). */
export const androidMpvActive = writable(false)

/** Live playback state, fed by the single mpv event subscription. Read by AndroidPlayer + tracking. */
export interface MpvState {
  pos: number
  dur: number
  paused: boolean
  eof: boolean
  /** `paused-for-cache` — playback stalled because the cache ran dry. */
  buffering: boolean
  /** `seeking` — mpv is resolving a seek; the target frame isn't up yet. */
  seeking: boolean
  /** `core-idle` — no frame is being shown. Also true while merely paused, so never read alone. */
  coreIdle: boolean
  /** Our own optimistic flag: a seek has been issued but mpv hasn't reported the new position yet. */
  seekBusy: boolean
  /** A decoded frame has been presented after the current load/seek (`MPV_EVENT_PLAYBACK_RESTART`). */
  frameReady: boolean
  cacheEnd: number
}

const IDLE_STATE: MpvState = {
  pos: 0,
  dur: 0,
  paused: false,
  eof: false,
  buffering: false,
  seeking: false,
  coreIdle: false,
  seekBusy: false,
  frameReady: false,
  cacheEnd: 0,
}

export const mpvState = writable<MpvState>({ ...IDLE_STATE })

/** Wait for libmpv's presentation event, not merely an accepted `loadfile` command. This is the
 * Android equivalent of the desktop player's first-progress gate and keeps resolve timings tied to
 * the first visible frame. */
export function waitForMpvFirstFrame(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    let unsubscribe = () => {}
    const finish = (ready: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsubscribe()
      resolve(ready)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    unsubscribe = mpvState.subscribe((state) => {
      if (state.frameReady) finish(true)
    })
    // Svelte subscriptions emit synchronously. If the first value completed the promise before
    // `unsubscribe` was assigned, retire the now-real subscription here.
    if (settled) unsubscribe()
  })
}

// Android resolves mpv_command as soon as libmpv has QUEUED it, before the matching time-pos event.
// Keep ignoring older observations until that acknowledgement arrives, otherwise a stale event can
// snap the UI back and make the next relative seek use the wrong starting position.
let pendingSeekTarget: number | null = null
let seekGeneration = 0
let pendingSeekTimer: ReturnType<typeof setTimeout> | undefined

/** Drop the pending-seek bookkeeping WITHOUT writing the store — safe to call from inside an
 *  `mpvState.update` callback, where a nested write would be clobbered by the outer one. */
function clearPendingSeekTimers(generation?: number) {
  if (generation != null && generation !== seekGeneration) return false
  pendingSeekTarget = null
  clearTimeout(pendingSeekTimer)
  pendingSeekTimer = undefined
  return true
}

function clearPendingSeek(generation?: number) {
  if (!clearPendingSeekTimers(generation)) return
  mpvState.update((s) => (s.seekBusy ? { ...s, seekBusy: false } : s))
}

let embeddedChecked: boolean | undefined
export interface MpvPreparation {
  ready: boolean
  created: boolean
  durationMs: number
}
let preparation: MpvPreparation = { ready: false, created: false, durationMs: 0 }
let preparationPromise: Promise<boolean> | null = null

/** Snapshot included in redacted resolve diagnostics; contains timing/state only. */
export const mpvPreparationSnapshot = (): MpvPreparation => ({ ...preparation })

/**
 * Create the Android libmpv core during serialized idle boot work. The native command deliberately
 * leaves the SurfaceView and WebView untouched; first playback only has to attach the warm core.
 * Promise-cached so boot promotion and another caller can safely meet here.
 */
export function prepareEmbeddedPlayer(): Promise<boolean> {
  if (preparation.ready) return Promise.resolve(true)
  if (preparationPromise) return preparationPromise
  const started = performance.now()
  const pending = invoke<{ created?: boolean; durationMs?: number }>('plugin:mpv|mpv_prepare')
    .then((result) => {
      embeddedChecked = true
      preparation = {
        ready: true,
        created: result?.created !== false,
        durationMs: Number.isFinite(result?.durationMs)
          ? Number(result.durationMs)
          : Math.round(performance.now() - started),
      }
      return true
    })
    .catch(() => {
      embeddedChecked = false
      preparation = { ready: false, created: false, durationMs: 0 }
      return false
    })
  preparationPromise = pending
  return pending.finally(() => { if (preparationPromise === pending) preparationPromise = null })
}

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

/** True while the activity is in Android picture-in-picture (the miniplayer). Fed by the plugin, which
 *  detects the real mode change rather than assuming the request succeeded. */
export const androidPipActive = writable(false)

let progressSub: PluginListener | undefined
let eventSub: PluginListener | undefined
let pipSub: PluginListener | undefined
let mediaSub: PluginListener | undefined
// `loadfile` replaces the current entry asynchronously. libmpv reports the outgoing file's
// property changes + END_FILE before START_FILE for the replacement, even though `mpv_load` has
// already resolved. Ignore that tail so it cannot make the new episode look failed at time 0.
//
// The latch is DEADLINED: START_FILE can genuinely never arrive (surface never attached, a
// swallowed loadfile failure, an event lost while Android froze the WebView), and an un-deadlined
// latch then dropped every later event — the player sat on an optimistic spinner forever and even
// the pause button looked dead. Past the deadline the stream is let through again: stale-tail
// misattribution is a lesser evil than a permanently frozen store.
let awaitingLoadStart = false
let awaitingLoadStartAt = 0
const LOAD_START_LATCH_MAX_MS = 8_000
// The outgoing file's END_FILE arrives almost immediately after `loadfile`; one arriving well
// after that belongs to OUR load dying before START_FILE (bad URL, failed open) and must surface
// as eof so the premature-EOF recovery reacts now instead of the 60s never-started clock.
const OUTGOING_TAIL_MS = 2_000
/** Start the single observed-property subscription that keeps `mpvState` current. Idempotent;
 *  lives for the app session (the plugin core is recreated per play, the JS listener persists). */
export async function startMpvEvents(): Promise<void> {
  if (!progressSub) {
    progressSub = await addPluginListener('mpv', 'progress', (e: unknown) => {
      const { property, value } = e as { property: string; value: unknown }
      if (awaitingLoadStart) {
        if (Date.now() - awaitingLoadStartAt < LOAD_START_LATCH_MAX_MS) return
        awaitingLoadStart = false
      }
      mpvState.update((s) => {
        if (property === 'time-pos' && typeof value === 'number') {
          if (pendingSeekTarget != null) {
            if (Math.abs(value - pendingSeekTarget) > 2.5) return s
            // The clock landing does not mean the target frame is visible. The native
            // playback-restart event owns `frameReady`, so an unbuffered seek keeps its spinner.
            clearPendingSeekTimers()
            return { ...s, pos: value, seekBusy: false }
          }
          return { ...s, pos: value }
        }
        if (property === 'duration' && typeof value === 'number') return { ...s, dur: value }
        if (property === 'pause' && typeof value === 'boolean') return { ...s, paused: value }
        if (property === 'eof-reached') return { ...s, eof: value === true }
        if (property === 'paused-for-cache') return { ...s, buffering: value === true }
        if (property === 'seeking') return { ...s, seeking: value === true }
        if (property === 'core-idle') return { ...s, coreIdle: value === true }
        if (property === 'demuxer-cache-time' && typeof value === 'number') return { ...s, cacheEnd: value }
        return s
      })
    })
  }
  if (!eventSub) {
    eventSub = await addPluginListener('mpv', 'event', (e: unknown) => {
      const { id } = e as { id: unknown }
      // Stable mpv_event_id values: START_FILE=6, END_FILE=7, FILE_LOADED=8, SEEK=20,
      // PLAYBACK_RESTART=21.
      if (id === 6) {
        awaitingLoadStart = false
        traceResolve(currentResolveTrace(), 'Android mpv START_FILE')
        // START_FILE is the ownership boundary between the outgoing file and this load. Clear any
        // values delivered by the old file after mpvLoad's optimistic reset.
        mpvState.set({ ...IDLE_STATE, buffering: true })
      } else if (id === 20) {
        mpvState.update((s) => (s.frameReady ? { ...s, frameReady: false } : s))
      } else if (id === 7) {
        // Failed HLS inputs can emit END_FILE without ever changing the observed eof-reached
        // property. Treat the event itself as authoritative once the new file has started; an
        // END_FILE from the outgoing entry during `loadfile` replacement belongs to the old load
        // — but only in the brief replacement window. A late END_FILE while still latched is OUR
        // load dying before START_FILE: clear the latch and let eof drive recovery immediately.
        if (!awaitingLoadStart) {
          mpvState.update((s) => ({ ...s, eof: true }))
        } else if (Date.now() - awaitingLoadStartAt > OUTGOING_TAIL_MS) {
          awaitingLoadStart = false
          mpvState.update((s) => ({ ...s, eof: true, buffering: false }))
        }
      } else if (id === 8) {
        traceResolve(currentResolveTrace(), 'Android mpv FILE_LOADED')
      } else if (id === 21) {
        // A replacement can receive the outgoing file's final presentation event after loadfile
        // was queued. START_FILE is the ownership boundary; until then this is not our first frame.
        if (awaitingLoadStart) return
        // The definitive edge that says a frame is being presented again. Metadata and time-pos
        // updates can arrive first and must not retire the loader.
        traceResolve(currentResolveTrace(), 'Android mpv first frame presented')
        mpvState.update((s) => ({
          ...s,
          frameReady: true,
          seekBusy: false,
          seeking: false,
          coreIdle: false,
          buffering: false,
        }))
        clearPendingSeekTimers()
      }
    })
  }
  if (!pipSub) {
    pipSub = await addPluginListener('mpv', 'pip', (e: unknown) => {
      androidPipActive.set((e as { active?: unknown })?.active === true)
    })
  }
  if (!mediaSub) {
    mediaSub = await addPluginListener('mpv', 'media', (e: unknown) => {
      const action = (e as { action?: unknown })?.action
      if (action === 'next' || action === 'prev' || action === 'stop') {
        mediaActionHandler?.(action)
      }
    })
  }
}

export async function mpvLoad(p: MpvLoad): Promise<void> {
  seekGeneration++
  clearPendingSeekTimers()
  awaitingLoadStart = true
  awaitingLoadStartAt = Date.now()
  // Reset UI state for the new file (fresh time-pos/duration events will repopulate it).
  // buffering starts true — the spinner shows until the first frame's duration/time-pos lands.
  mpvState.set({ ...IDLE_STATE, buffering: true })
  await invoke('plugin:mpv|mpv_load', {
    payload: {
      url: p.url,
      title: p.title ?? null,
      startPos: p.startPos ?? 0,
      subtitles: p.subtitles ?? [],
      alang: p.alang ?? null,
      slang: p.slang ?? null,
      headers: p.headers ?? {},
    },
  })
  // The reusable core can be paused by keep-open at EOF. Reassert the
  // transition's play/pause intent after queueing the replacement file.
  await mpvCommand(['set', 'pause', p.autoplay === false ? 'yes' : 'no'])
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
  // Native stop destroys the core as well as the SurfaceView; the next play must not mistake the
  // prior idle preparation for a still-live core.
  preparation = { ready: false, created: false, durationMs: 0 }
  seekGeneration++
  clearPendingSeekTimers()
  mpvState.set({ ...IDLE_STATE })
  androidStreamInfo.set(null)
  androidPipActive.set(false)
}

/** Enter Android picture-in-picture. Video keeps rendering into the SurfaceView in the PIP window. */
export const mpvPip = () => invoke('plugin:mpv|mpv_pip')

/**
 * Arm/disarm automatic picture-in-picture. On Android 12+ the system itself shrinks the app into
 * the miniplayer on the home/recents gesture; older releases fall back to a best-effort request
 * from the activity's pause. Only takes effect while something is actually playing.
 */
export const setAndroidAutoPip = (enabled: boolean) =>
  invoke('plugin:mpv|mpv_auto_pip', { payload: { enabled } }).catch(() => {})

/** Now-playing identity for the lock-screen / notification-shade transport. */
export interface AndroidMediaSession {
  /** False tears the transport down (playback stopped). */
  enabled: boolean
  /** Primary line — the series. */
  title?: string
  /** Secondary line — the episode. */
  subtitle?: string
  /** Poster URL, fetched natively for the transport artwork. */
  artwork?: string | null
  hasPrev?: boolean
  hasNext?: boolean
}

/**
 * Publish (or remove) the system media transport. The scrubber the user drags in the notification
 * is drawn by Android from this session, not by us — the native side keeps its position/duration
 * current from the same mpv observers that feed `mpvState`.
 */
export const setAndroidMediaSession = (p: AndroidMediaSession) =>
  invoke('plugin:mpv|mpv_media_session', {
    payload: {
      enabled: p.enabled,
      title: p.title ?? '',
      subtitle: p.subtitle ?? '',
      artwork: p.artwork ?? null,
      hasPrev: p.hasPrev === true,
      hasNext: p.hasNext === true,
    },
  }).catch(() => {})

/** Ask for POST_NOTIFICATIONS (API 33+). Denied means the media transport stays hidden; playback
 *  itself is unaffected, so this never blocks. */
export async function requestAndroidNotifications(): Promise<boolean> {
  try {
    const r = (await invoke('plugin:mpv|mpv_request_notifications')) as { granted?: boolean }
    return r?.granted === true
  } catch {
    return false
  }
}

/** What the notification / lock-screen transport asked for. Play/pause and seeking are answered
 *  natively (they must work even when Android has frozen the WebView); these three need the app's
 *  own episode logic. */
export type AndroidMediaAction = 'next' | 'prev' | 'stop'

let mediaActionHandler: ((action: AndroidMediaAction) => void) | null = null
/** Register the player's handler for transport buttons. Pass null on teardown. */
export function setAndroidMediaHandler(fn: ((action: AndroidMediaAction) => void) | null) {
  mediaActionHandler = fn
}

// --- GIF recording (embedded full flavor) ---
// Frames come straight out of the live core as JPEGs (Kotlin), Rust turns them into a GIF, then
// Kotlin publishes it to the gallery. Split that way because only Kotlin can reach MediaStore and
// only Rust has the encoder — see `android_gif_encode` and the plugin's `gifSave`.

interface GifFrames {
  dir: string
  frames: number
  capturedMs: number
}

export const androidGifStart = (includeSubtitles: boolean) =>
  invoke('plugin:mpv|mpv_gif_start', { payload: { includeSubtitles } })

/** Cancel a live capture and drop its frames. Safe when nothing is recording. */
export const androidGifAbort = () => invoke('plugin:mpv|mpv_gif_abort').catch(() => {})

/** Stop, encode and publish. Resolves with where the finished GIF landed. */
export async function androidGifStop(): Promise<{ name: string; location: string }> {
  const frames = (await invoke('plugin:mpv|mpv_gif_stop')) as GifFrames
  try {
    const path = await invoke<string>('android_gif_encode', {
      dir: frames.dir,
      capturedMs: Math.max(0, Math.round(frames.capturedMs ?? 0)),
    })
    return (await invoke('plugin:mpv|mpv_gif_save', {
      payload: { path, cleanupDir: frames.dir },
    })) as { name: string; location: string }
  } catch (error) {
    // The encoder owns the frame directory only on the success path, so a failed encode has to
    // clean up after itself or every abandoned capture stays in the cache.
    await invoke('plugin:mpv|mpv_gif_save', { payload: { path: '', cleanupDir: frames.dir } }).catch(() => {})
    throw error
  }
}

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

/** mpv chapters (time in seconds + title), via sub-property paths. Empty when the file has none.
 *  Titles are needed for chapter-derived skip segments — see player/chapter-skip.ts. Keeps every
 *  entry with a finite, non-negative time (matching the desktop Rust `chapters()` command and the
 *  `>= 0` contract `sortChapters()` documents), so this file's chapter list agrees across platforms. */
export async function getChapterList(): Promise<{ time: number; title: string }[]> {
  const count = Number(await mpvGet('chapter-list/count')) || 0
  const out: { time: number; title: string }[] = []
  for (let i = 0; i < count; i++) {
    const t = Number(await mpvGet(`chapter-list/${i}/time`))
    // A cold-open/"Intro" chapter starting at exactly 0:00 is legitimate and common on well-tagged
    // anime releases — do not drop it. Only genuinely invalid times (NaN/Infinity, or negative) go.
    if (!isFinite(t) || t < 0) continue
    // Untitled chapters read back as an empty string (or nothing at all); that's a non-match for
    // the classifier, which is what we want.
    const title = String((await mpvGet(`chapter-list/${i}/title`)) ?? '')
    out.push({ time: t, title })
  }
  return out
}

/** Chapter marker times only, for the seekbar ticks. */
export async function getChapters(): Promise<number[]> {
  return (await getChapterList()).map((c) => c.time)
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
    // seekBusy from the instant the seek is requested: mpv only reports `seeking` once the command
    // has crossed the JNI bridge and been picked up, and that gap is exactly where a fast-forward
    // into unbuffered data used to look like a frozen player.
    return { ...s, pos: target, seekBusy: true, frameReady: false }
  })
  const generation = ++seekGeneration
  clearTimeout(pendingSeekTimer)
  pendingSeekTarget = target
  // Armed BEFORE the command is awaited: when the bridge itself wedges (the command promise never
  // settles), the old then()-armed timer never existed, so `seekBusy` stayed true forever — which
  // both froze the seek UI and disarmed the recovery watchdog (it skips checks mid-seek).
  pendingSeekTimer = setTimeout(async () => {
    if (generation !== seekGeneration || pendingSeekTarget == null) return
    const rawActual = await mpvGet('time-pos')
    const actual = rawActual == null ? Number.NaN : Number(rawActual)
    if (generation !== seekGeneration) return
    clearPendingSeek(generation)
    if (Number.isFinite(actual)) mpvState.update((s) => ({ ...s, pos: actual }))
  }, 2000)
  return mpvCommand(['seek', target.toFixed(3), 'absolute+exact']).catch((error) => {
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
// The rejection is EXPECTED on the lite flavor, where the plugin is absent — but swallowing it
// outright also hid a command that was never registered on the Rust side at all, so keep-awake
// silently did nothing for every build. Warn once per command instead of never: one line in
// logcat distinguishes "lite, as designed" from "wired to a command that does not exist".
const warned = new Set<string>()
const optionalPluginCall = (command: string, payload: Record<string, unknown>) =>
  invoke(`plugin:mpv|${command}`, { payload }).catch((error) => {
    if (warned.has(command)) return
    warned.add(command)
    console.warn(`[android-mpv] ${command} unavailable:`, error)
  })

/** Screen brightness 0..1, or -1 to restore system/auto brightness. */
export const setBrightness = (value: number) => optionalPluginCall('mpv_brightness', { value })
/** Keep Android's display awake while a decoded video frame is actively playing. */
export const setAndroidKeepScreenAwake = (enabled: boolean) =>
  optionalPluginCall('mpv_keep_screen_awake', { enabled })
/** Short haptic pulse (ms). */
export const haptic = (ms: number) => optionalPluginCall('mpv_haptic', { ms })

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
