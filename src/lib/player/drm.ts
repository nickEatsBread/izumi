/** Generic encrypted-stream contract. A source package fills this; izumi plays
 *  it through the webview CDM + Shaka. Not vendor-specific. */

export interface StreamDrm {
  keySystem: string
  /** Absent for an `offline:` manifest whose persistent license is already stored by Shaka. */
  licenseUrl?: string
  /** Optional provider cleanup endpoint for releasing a scarce playback slot. */
  releaseUrl?: string
  /** Optional provider endpoint that refreshes tracks after its lazy manifest is materialized. */
  refreshUrl?: string
  licenseHeaders?: Record<string, string>
  serverCertificateUrl?: string
  videoRobustness?: string
  audioRobustness?: string
}

export interface DrmSubtitle {
  url: string
  lang?: string
  title?: string
  isDefault?: boolean
  /** Dialogue vs closed captions. Independent of audio. */
  kind?: 'subtitles' | 'captions'
  /** Burned-in DASH URL. Selecting this track reloads Shaka instead of swapping a text track. */
  switchUrl?: string
}

/** Alternate audio that lives on a different encrypted stream (not muxed). */
export interface DrmAudioChoice {
  lang?: string
  title?: string
  switchUrl?: string
}

export interface DrmSnapshot {
  pos: number
  dur: number
  /** Buffered-end timestamp in seconds (same unit as mpv's player-buffer event). */
  buffer: number
  paused: boolean
  buffering: boolean
  ended: boolean
  firstFrame: boolean
  volume: number
  muted: boolean
  error: string | null
  videoWidth: number
  videoHeight: number
}

export interface DrmTrack {
  id: number
  type: 'audio' | 'sub' | 'caption' | string
  title?: string
  lang?: string
  selected?: boolean
  codec?: string
  channels?: number
  forced?: boolean
  switchUrl?: string
}

/** Map a Shaka/HTML text-track kind onto the player menu: dialogue vs closed captions. */
export function drmTextType(kind?: string | null): 'sub' | 'caption' {
  const k = (kind ?? '').toLowerCase()
  return k === 'captions' || k === 'caption' ? 'caption' : 'sub'
}

export interface DrmMedia {
  currentTime: number
  duration: number
  paused: boolean
  muted: boolean
  volume: number
  playbackRate: number
  play(): void
  pause(): void
}

export interface DrmEngine {
  command(name: string, args: string[]): void
  getProperty(name: string): string
  tracks(): DrmTrack[]
  screenshot?: (fast?: boolean) => Promise<void>
  /** Capture composed DRM frames; direct video/canvas reads are black under Widevine. */
  gifStart?: (includeSubtitles: boolean, fast?: boolean) => Promise<void>
  gifStop?: () => Promise<void>
  gifAbort?: () => Promise<void>
  /** Seek-bar hover preview as a data/HTTP URL, or null when this stream has no tiles. */
  thumbnail?: (time: number) => Promise<string | null>
  destroy(): void
}

let engine: DrmEngine | null = null

export function setDrmEngine(next: DrmEngine | null): void {
  engine = next
}

export function getDrmEngine(): DrmEngine | null {
  return engine
}

export function drmPlaybackActive(): boolean {
  return engine != null
}

/** mpv style colours are #AARRGGBB; CSS uses #RRGGBBAA. */
export function mpvColorToCss(value: string, fallback = '#ffffffff'): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{6})$/i.exec(value.trim())
  return match ? `#${match[2]}${match[1]}`.toLowerCase() : fallback
}

export function parseStreamDrm(value: unknown): StreamDrm | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.licenseUrl !== 'string' || !raw.licenseUrl) return undefined
  const keySystem = typeof raw.keySystem === 'string' && raw.keySystem
    ? raw.keySystem
    : 'com.widevine.alpha'
  const headers = raw.licenseHeaders && typeof raw.licenseHeaders === 'object'
    ? Object.fromEntries(
      Object.entries(raw.licenseHeaders as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
    : undefined
  return {
    keySystem,
    licenseUrl: raw.licenseUrl,
    releaseUrl: typeof raw.releaseUrl === 'string' && raw.releaseUrl ? raw.releaseUrl : undefined,
    refreshUrl: typeof raw.refreshUrl === 'string' && raw.refreshUrl ? raw.refreshUrl : undefined,
    licenseHeaders: headers && Object.keys(headers).length ? headers : undefined,
    serverCertificateUrl: typeof raw.serverCertificateUrl === 'string'
      ? raw.serverCertificateUrl
      : undefined,
    videoRobustness: typeof raw.videoRobustness === 'string' ? raw.videoRobustness : undefined,
    audioRobustness: typeof raw.audioRobustness === 'string' ? raw.audioRobustness : undefined,
  }
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

/** End of the TimeRange that covers `currentTime`, matching mpv's `demuxer-cache-time`. */
/** Roku/Fire TV BIF: timestamped JPEGs used as seek-bar hover frames. */
export function parseBif(bytes: Uint8Array): { time: number; start: number; end: number }[] {
  if (bytes.length < 72) return []
  const magic = bytes[0] === 0x89 && bytes[1] === 0x42 && bytes[2] === 0x49 && bytes[3] === 0x46
  if (!magic) return []
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint32(12, true)
  const multiplier = view.getUint32(16, true) || 1000
  if (count <= 0 || count > 20_000) return []
  const frames: { time: number; start: number; end: number }[] = []
  for (let i = 0; i < count; i++) {
    const off = 64 + i * 8
    if (off + 16 > bytes.length) break
    const ts = view.getUint32(off, true)
    const start = view.getUint32(off + 4, true)
    const next = view.getUint32(off + 12, true)
    if (ts === 0xFFFFFFFF) break
    if (start <= 0 || start >= bytes.length) continue
    const end = next > start && next <= bytes.length ? next : bytes.length
    frames.push({ time: (ts * multiplier) / 1000, start, end })
  }
  return frames
}

/** Nearest BIF index entry for a hover timestamp. Does not slice JPEG bytes. */
export function nearestBifFrame<T extends { time: number }>(frames: T[], time: number): T | undefined {
  if (!frames.length) return undefined
  let best = frames[0]!
  let dist = Math.abs(best.time - time)
  for (let i = 1; i < frames.length; i++) {
    const frame = frames[i]!
    const d = Math.abs(frame.time - time)
    if (d < dist) {
      best = frame
      dist = d
    }
  }
  return best
}

/** DASH/EME often reports `duration` as Infinity until Shaka exposes a seek range. */
export function playbackDuration(
  media: { duration: number } | undefined,
  range?: { start: number; end: number } | null,
): number {
  const d = media?.duration ?? 0
  if (Number.isFinite(d) && d > 0) return d
  const start = range?.start ?? 0
  const end = range?.end ?? 0
  if (Number.isFinite(end) && end > start) return end - Math.max(0, start)
  return 0
}

/** Keep the overlay clock stable while Shaka unloads a presentation. Publishing 0
 *  during a manifest switch is what made the time display bounce 0 → duration. */
export function holdPlaybackDuration(next: number, previous: number, switching: boolean): number {
  if (next > 0) return next
  if (switching && previous > 0) return previous
  return next
}

export function clampSeekTime(
  time: number,
  duration: number,
  range?: { start: number; end: number } | null,
): number {
  let t = Math.max(0, time)
  if (range && Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start) {
    t = Math.min(Math.max(t, range.start), Math.max(range.start, range.end - 0.05))
  } else if (duration > 0) {
    t = Math.min(t, duration)
  }
  return t
}

export function bufferedEnd(media: { buffered: TimeRanges; currentTime: number }): number {
  const ranges = media.buffered
  const t = media.currentTime
  for (let i = 0; i < ranges.length; i++) {
    const start = ranges.start(i)
    const end = ranges.end(i)
    if (t >= start - 0.35 && t <= end + 0.05) return end
  }
  return ranges.length ? ranges.end(ranges.length - 1) : 0
}

/** Map a CSS-pixel video box onto a compositor PNG. Extra height is treated as a top titlebar. */
export function mapScreenshotCrop(
  imageWidth: number,
  imageHeight: number,
  viewWidth: number,
  viewHeight: number,
  box: { x: number; y: number; width: number; height: number },
): { sx: number; sy: number; sw: number; sh: number } {
  const vw = Math.max(1, viewWidth)
  const vh = Math.max(1, viewHeight)
  const scale = imageWidth / vw
  const extraY = Math.max(0, imageHeight - vh * scale)
  return {
    sx: box.x * scale,
    sy: extraY + box.y * scale,
    sw: Math.max(1, box.width * scale),
    sh: Math.max(1, box.height * scale),
  }
}

/** Encrypted-canvas captures are uniform black. Dark scenes still
 *  have some pixels above this floor; a Widevine `drawImage` frame does not. */
export function isSolidBlackImageData(data: Uint8ClampedArray, maxChannel = 8): boolean {
  if (data.length < 16) return true
  const pixelStride = 4
  const stepPixels = Math.max(1, Math.floor(data.length / pixelStride / 1024))
  const step = stepPixels * pixelStride
  for (let i = 0; i + 2 < data.length; i += step) {
    if (data[i] > maxChannel || data[i + 1] > maxChannel || data[i + 2] > maxChannel) return false
  }
  return true
}

/** Visible video rectangle inside an object-fit contain/cover element, in CSS pixels. */
export function videoShotRect(
  video: { getBoundingClientRect(): DOMRect; videoWidth: number; videoHeight: number },
  fit: 'contain' | 'cover' | 'fill' | string = 'contain',
): { x: number; y: number; width: number; height: number } {
  const r = video.getBoundingClientRect()
  const vw = video.videoWidth || r.width
  const vh = video.videoHeight || r.height
  if (!vw || !vh || fit === 'cover' || fit === 'fill') {
    return { x: r.x, y: r.y, width: Math.max(1, r.width), height: Math.max(1, r.height) }
  }
  const scale = Math.min(r.width / vw, r.height / vh)
  const width = Math.max(1, vw * scale)
  const height = Math.max(1, vh * scale)
  return {
    x: r.x + (r.width - width) / 2,
    y: r.y + (r.height - height) / 2,
    width,
    height,
  }
}

export function applyPlayerCommand(media: DrmMedia, name: string, args: string[] = []): void {
  if (name === 'cycle' && args[0] === 'pause') {
    if (media.paused) media.play()
    else media.pause()
    return
  }
  if (name === 'cycle' && args[0] === 'mute') {
    media.muted = !media.muted
    return
  }
  if (name === 'set' && args[0] === 'pause') {
    if (args[1] === 'yes' || args[1] === 'true') media.pause()
    else media.play()
    return
  }
  if (name === 'set' && args[0] === 'mute') {
    media.muted = args[1] === 'yes' || args[1] === 'true'
    return
  }
  if (name === 'set' && args[0] === 'volume') {
    const n = Number(args[1])
    if (Number.isFinite(n)) media.volume = clamp01(n / 100)
    return
  }
  if (name === 'set' && args[0] === 'speed') {
    const n = Number(args[1])
    if (Number.isFinite(n) && n > 0) media.playbackRate = n
    return
  }
  if (name === 'add' && args[0] === 'volume') {
    const n = Number(args[1])
    if (Number.isFinite(n)) media.volume = clamp01(media.volume + n / 100)
    return
  }
  if (name === 'add' && args[0] === 'speed') {
    const n = Number(args[1])
    if (Number.isFinite(n) && n !== 0) {
      const next = (media.playbackRate || 1) + n
      if (next > 0) media.playbackRate = next
    }
    return
  }
  if (name === 'seek') {
    const amount = Number(args[0])
    if (!Number.isFinite(amount)) return
    const mode = args[1] ?? 'relative'
    const next = mode.startsWith('absolute') ? amount : media.currentTime + amount
    const duration = Number.isFinite(media.duration) ? media.duration : 0
    media.currentTime = clampSeekTime(next, duration)
  }
}

export function playerProperty(media: DrmMedia, name: string): string {
  switch (name) {
    case 'time-pos': return String(media.currentTime || 0)
    case 'duration': return String(media.duration || 0)
    case 'pause': return media.paused ? 'yes' : 'no'
    case 'mute': return media.muted ? 'yes' : 'no'
    case 'volume': return String(Math.round((media.volume ?? 1) * 100))
    case 'speed': return String(media.playbackRate || 1)
    default: return ''
  }
}

export function emitDrmProgress(pos: number, dur: number): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('izumi-drm-progress', { detail: { pos, dur } }))
}

export function emitDrmEnded(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('izumi-drm-ended'))
}

export const DRM_PROGRESS_EVENT = 'izumi-drm-progress'
export const DRM_ENDED_EVENT = 'izumi-drm-ended'

/** ASS clock (`H:MM:SS.cs`) → WebVTT (`HH:MM:SS.mmm`). */
export function assTimeToVtt(raw: string): string {
  const m = raw.trim().match(/^(\d+):(\d{1,2}):(\d{1,2})[.:](\d{1,3})$/)
  if (!m) return '00:00:00.000'
  const hours = (m[1] ?? '0').padStart(2, '0')
  const minutes = (m[2] ?? '00').padStart(2, '0')
  const seconds = (m[3] ?? '00').padStart(2, '0')
  const frac = m[4] ?? '0'
  const millis = (frac.length <= 2 ? frac.padEnd(3, '0') : frac.slice(0, 3))
  return `${hours}:${minutes}:${seconds}.${millis}`
}

/** Drop ASS override blocks and convert `\N` line breaks. */
export function stripAssTags(text: string): string {
  return text
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\[nN]/g, '\n')
    .replace(/\\h/g, ' ')
    .replace(/\\[a-zA-Z]+\d*/g, '')
    .trim()
}

/** Convert an ASS/SSA sidecar into WebVTT so the webview can render the cues. */
export function assToVtt(source: string): string {
  const lines = source.split(/\r?\n/)
  let textIndex = 9
  const cues: string[] = ['WEBVTT', '']
  for (const line of lines) {
    if (/^format:/i.test(line)) {
      const cols = line.replace(/^format:\s*/i, '').split(',').map((c) => c.trim().toLowerCase())
      const idx = cols.indexOf('text')
      if (idx >= 0) textIndex = idx
      continue
    }
    if (!/^dialogue:/i.test(line)) continue
    const body = line.replace(/^dialogue:\s*/i, '')
    const parts = body.split(',')
    if (parts.length <= textIndex) continue
    const start = assTimeToVtt(parts[1] ?? '')
    const end = assTimeToVtt(parts[2] ?? '')
    const text = stripAssTags(parts.slice(textIndex).join(','))
    if (!text) continue
    cues.push(`${start} --> ${end}`, text, '')
  }
  return cues.join('\n')
}
