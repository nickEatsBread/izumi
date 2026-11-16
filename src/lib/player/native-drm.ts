/** Protected streams played by izumi's own player (Linux): the Rust side hosts the Widevine module
 *  and mpv renders the result, so everything except presentation switching and previews is the
 *  ordinary mpv path. Windows and macOS keep the webview (Shaka) path in DrmSurface for playback and
 *  use the module host only to save protected episodes. */
import { invoke } from '@tauri-apps/api/core'
import { writable, get } from 'svelte/store'
import { nearestBifFrame, parseBif, type DrmTrack, type StreamDrm } from './drm'

export const WIDEVINE = 'com.widevine.alpha'
/** Error text the Rust side returns when the module has not been downloaded and accepted yet. */
export const NOT_INSTALLED = 'widevine-not-installed'
/** What a protected download says when this device has nothing that can decrypt it (no module set up,
 *  and no Widevine device of the user's own). Points at the one place that fixes it. */
export const PROTECTED_SAVE_SETUP = "Protected episodes can't be saved on this device yet. Set up Protected video in Settings › Playback, then try again."
/** Track ids for alternate presentations, above any id mpv assigns. */
export const NATIVE_SWITCH_ID = 20_000

/** The Rust side's `widevine_status`. Two different capabilities — keep them apart:
 *  - `supported`: izumi hosts the module on this build, so protected episodes can be SAVED through it
 *    (Linux, Windows, macOS).
 *  - `playback`: protected streams also PLAY through izumi's own player (Linux only). Windows and macOS
 *    play them in the webview; routing their playback on `supported` sends it to a native surface
 *    those builds do not have. */
export interface WidevineStatus {
  supported: boolean
  playback?: boolean
  installed: string | null
  /** A browser's own module version on this device (Windows, macOS): setting it up downloads nothing. */
  available?: string | null
}

/** True when this build can save protected episodes through its own module host. Resolved once at boot. */
export const nativeDrmSupported = writable(false)
/** True when this build also plays protected streams through its own player (Linux). Resolved once at boot. */
export const nativeDrmPlayback = writable(false)

/** The two capabilities a status grants. Playback is never assumed from `supported`. */
export function drmCapabilities(status: Partial<WidevineStatus> | null | undefined): { save: boolean; playback: boolean } {
  const save = !!status?.supported
  return { save, playback: save && !!status?.playback }
}

export async function initNativeDrm(): Promise<void> {
  let status: WidevineStatus | null = null
  try {
    status = await invoke<WidevineStatus>('widevine_status')
  } catch { /* no module host on this build */ }
  const capable = drmCapabilities(status)
  nativeDrmSupported.set(capable.save)
  nativeDrmPlayback.set(capable.playback)
}

/** Whether `drm` goes through izumi's module host rather than the webview, given the capability that
 *  applies: pass `nativeDrmPlayback` for playback routing; saving uses the default (`nativeDrmSupported`). */
export function usesNativeDrm(drm: StreamDrm | null | undefined, supported = get(nativeDrmSupported)): boolean {
  if (!drm || !supported) return false
  if ((drm.keySystem || WIDEVINE) !== WIDEVINE) return false
  return !!drm.licenseUrl
}

export interface NativeQuality {
  mode: 'auto' | number
  activeHeight: number
  heights: number[]
}

/** What the mounted NativeDrmSurface exposes to the player IPC helpers. */
export interface NativeDrmSession {
  /** Seek-bar preview for `time`, from the source's preview images. */
  thumbnail(time: number): Promise<string | null>
  /** Alternate audio and burned-in subtitle presentations for the track menu. */
  switchTracks(): DrmTrack[]
  /** True when the menu's audio choices are presentations, so mpv's own audio list is hidden. */
  ownsAudioMenu(): boolean
  /** Handles `set aid|sid <id>`; returns true when it did (a presentation switch or its undo). */
  select(property: 'aid' | 'sid', value: string): boolean
  quality(): NativeQuality
  setQuality(mode: string): void
}

let session: NativeDrmSession | null = null

export function setNativeDrm(next: NativeDrmSession | null): void {
  session = next
}

export function getNativeDrm(): NativeDrmSession | null {
  return session
}

/** Merge mpv's track list with the presentation choices. */
export function mergeNativeTracks(mpvJson: string, native: NativeDrmSession): string {
  let tracks: DrmTrack[] = []
  try { tracks = JSON.parse(mpvJson) as DrmTrack[] } catch { tracks = [] }
  const extra = native.switchTracks()
  const hardActive = extra.some((t) => t.type === 'sub' && t.selected)
  const kept = tracks.filter((t) => {
    if (t.type === 'audio' && native.ownsAudioMenu()) return false
    return true
  }).map((t) => (hardActive && (t.type === 'sub' || t.type === 'caption') ? { ...t, selected: false } : t))
  return JSON.stringify([...kept, ...extra])
}

/** Roku-style BIF preview images, fetched once per presentation and sliced on demand. */
export class BifPreviews {
  private bytes: Uint8Array | null = null
  private index: { time: number; start: number; end: number }[] = []
  private job: Promise<void> | null = null
  private cache = new Map<number, string>()
  private disposed = false

  constructor(private readonly url: string) {}

  private load(): Promise<void> {
    if (!this.job) {
      this.job = (async () => {
        try {
          const res = await fetch(this.url)
          if (!res.ok || this.disposed) return
          const bytes = new Uint8Array(await res.arrayBuffer())
          const index = parseBif(bytes)
          if (!index.length || this.disposed) return
          this.bytes = bytes
          this.index = index
        } catch { /* no previews */ }
      })()
    }
    return this.job
  }

  warm(): void {
    void this.load()
  }

  async at(time: number): Promise<string | null> {
    await this.load()
    if (!this.bytes || !this.index.length) return null
    const frame = nearestBifFrame(this.index, time)
    if (!frame) return null
    const hit = this.cache.get(frame.start)
    if (hit) return hit
    const url = URL.createObjectURL(new Blob([this.bytes.slice(frame.start, frame.end)], { type: 'image/jpeg' }))
    if (this.cache.size >= 240) {
      const oldest = this.cache.keys().next().value
      if (oldest != null) {
        URL.revokeObjectURL(this.cache.get(oldest)!)
        this.cache.delete(oldest)
      }
    }
    this.cache.set(frame.start, url)
    return url
  }

  dispose(): void {
    this.disposed = true
    for (const url of this.cache.values()) URL.revokeObjectURL(url)
    this.cache.clear()
    this.bytes = null
    this.index = []
  }
}
