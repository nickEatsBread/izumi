import { invoke } from '@tauri-apps/api/core'
import { addPluginListener, type PluginListener } from '@tauri-apps/api/core'
import { writable } from 'svelte/store'

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
      if (property === 'time-pos' && typeof value === 'number') return { ...s, pos: value }
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
  mpvState.set({ pos: 0, dur: 0, paused: false, eof: false, buffering: false, cacheEnd: 0 })
}

/** Enter Android picture-in-picture. Video keeps rendering into the SurfaceView in the PIP window. */
export const mpvPip = () => invoke('plugin:mpv|mpv_pip')

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
export const seekAbsolute = (sec: number) => mpvCommand(['seek', sec.toFixed(3), 'absolute'])
export const seekRelative = (delta: number) => mpvCommand(['seek', delta.toString(), 'relative'])
