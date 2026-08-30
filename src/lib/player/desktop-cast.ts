import { invoke } from '@tauri-apps/api/core'
import { get, writable } from 'svelte/store'
import { castSubtitleFormat, type CastTrack } from './android-cast'
import { SamsungSmartViewChannel } from './samsung-smart-view'

export interface DesktopCastDevice {
  id: string
  name: string
  model?: string
  manufacturer?: string
  address: string
  port: number
  protocol: 'googleCast' | 'dlna'
}

export interface DesktopCastSession {
  deviceId: string
  deviceName: string
  backend: 'googleCast' | 'dlna' | 'tizenReceiver'
  /** Playback identity prevents a surviving cast from controlling a newly opened item. */
  mediaId?: number | null
  episode?: number | null
  subtitles: { trackId: number; title: string; lang?: string }[]
  activeTrackIds: number[]
}

export interface DesktopCastStatus {
  state: 'playing' | 'paused' | 'buffering' | 'idle'
  positionSeconds: number
  durationSeconds?: number
  volume?: number
  muted?: boolean
}

type TizenCastStatus = DesktopCastStatus & { sessionId: string }

type ActiveTizenCast = {
  channel: SamsungSmartViewChannel
  sessionId: string
  deviceId: string
  deviceName: string
  status: TizenCastStatus
}

let activeTizenCast: ActiveTizenCast | null = null

/** Survives the player's auto-hiding Controls component being unmounted and remounted. */
export const desktopCastSession = writable<DesktopCastSession | null>(null)
/** Latest receiver clock, shared by the player, history, titlebar, and Cast popover. */
export const desktopCastStatus = writable<DesktopCastStatus | null>(null)

/** A cast belongs to the player item that started it. Unscoped sessions are retained for
 * compatibility with sessions created before playback identity was added. */
export function desktopCastSessionMatchesPlayback(
  session: DesktopCastSession | null,
  mediaId: number | null | undefined,
  episode: number | null | undefined,
): boolean {
  if (!session) return false
  if (session.mediaId != null && session.mediaId !== mediaId) return false
  if (session.episode != null && session.episode !== (episode ?? null)) return false
  return true
}

const PLAYING_POLL_MS = 3_000
const IDLE_POLL_MS = 6_000
let pollGeneration = 0
let pollTimer: ReturnType<typeof setTimeout> | null = null
let renderingPoll = 0
let pollFailures = 0

export interface CastSubtitleSource {
  url: string
  lang?: string
  title?: string
  headers?: Record<string, string>
}

export interface CastSourceWithSubtitles {
  url: string
  headers?: Record<string, string>
  manifest?: 'hls' | 'dash'
  subtitles?: CastSubtitleSource[]
}

export interface PreparedCastSource {
  url: string
  relayed: boolean
  subtitles: { url: string; lang?: string; title?: string; contentType: string }[]
}

export interface DesktopCastPrepareOptions {
  forceRelay?: boolean
  contentType?: string
  subtitleDelivery?: 'web' | 'samsungDlna'
}

export interface DesktopCastStartInput {
  device: DesktopCastDevice
  deviceId: string
  url: string
  title?: string
  contentType: string
  positionSeconds: number
  subtitles: PreparedCastSource['subtitles']
  activeTrackIds: number[]
}

/** Match mpv's selected external track back to the source sidecar that the LAN relay can fetch. */
export function selectedCastSubtitle(
  source: CastSourceWithSubtitles,
  tracks: CastTrack[],
): CastSubtitleSource | null {
  const selected = tracks.find((track) => track.type === 'sub' && track.selected)
  if (!selected) return null
  const external = selected.externalFilename
  return source.subtitles?.find((candidate) => {
    if (!castSubtitleFormat(candidate.url)) return false
    if (external) return candidate.url === external
    return (!!candidate.title && candidate.title === selected.title)
      || (!!candidate.lang && candidate.lang === selected.lang)
  }) ?? null
}

export function discoverDesktopCast(waitMs = 1_800): Promise<DesktopCastDevice[]> {
  return invoke('desktop_cast_discover', { request: { waitMs } })
}

export function prepareDesktopCast(
  source: CastSourceWithSubtitles,
  subtitles: CastSubtitleSource[],
  options: DesktopCastPrepareOptions = {},
): Promise<PreparedCastSource> {
  return invoke('cast_prepare_source', {
    request: {
      url: source.url,
      headers: source.headers ?? {},
      manifest: source.manifest,
      forceRelay: options.forceRelay ?? false,
      contentType: options.contentType,
      subtitleDelivery: options.subtitleDelivery ?? 'web',
      subtitles: subtitles.map((subtitle) => ({
        url: subtitle.url,
        lang: subtitle.lang,
        title: subtitle.title,
        format: castSubtitleFormat(subtitle.url),
        headers: subtitle.headers ?? {},
      })),
    },
  })
}

const samsungDevice = (device: DesktopCastDevice) =>
  device.protocol === 'dlna'
  && /samsung/i.test(`${device.manufacturer ?? ''} ${device.model ?? ''} ${device.name}`)

export function desktopCastSupportsDlnaSubtitles(device: DesktopCastDevice): boolean {
  return samsungDevice(device)
}

export function desktopCastContentType(device: DesktopCastDevice, contentType: string): string {
  const normalized = contentType.split(';')[0]?.trim().toLowerCase() || contentType
  if (!samsungDevice(device)) return normalized
  switch (normalized) {
    case 'video/x-matroska':
    case 'application/x-matroska': return 'video/x-mkv'
    case 'audio/flac': return 'audio/x-flac'
    case 'audio/wav': return 'audio/x-wav'
    case 'video/mp2t': return 'video/mpeg'
    default: return normalized
  }
}

const sessionId = () => globalThis.crypto?.randomUUID?.()
  ?? `izumi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

async function startTizenReceiver(
  device: DesktopCastDevice,
  request: Omit<DesktopCastStartInput, 'device'>,
): Promise<Omit<DesktopCastSession, 'subtitles' | 'activeTrackIds'> | null> {
  if (!samsungDevice(device)) return null
  const channel = new SamsungSmartViewChannel(device.address, { name: 'Izumi Desktop' })
  try {
    await channel.connect()
    // A plain Smart View channel can exist with no TV app attached. Only select this backend when
    // Samsung identifies the open local Izumi app as the channel host.
    if (!channel.hasReceiver) {
      channel.disconnect()
      return null
    }
    const id = sessionId()
    const confirmed = await new Promise<TizenCastStatus>((resolve, reject) => {
      const timer = setTimeout(() => {
        off()
        reject(new Error('The Izumi TV receiver did not accept playback'))
      }, 3_000)
      const off = channel.on('izumi.status', (value) => {
        const status = value as Partial<TizenCastStatus> | null
        if (!status || status.sessionId !== id || typeof status.state !== 'string') return
        clearTimeout(timer)
        off()
        resolve(status as TizenCastStatus)
      })
      channel.publish('izumi.load', { ...request, sessionId: id }, 'host')
    })
    const active: ActiveTizenCast = {
      channel,
      sessionId: id,
      deviceId: device.id,
      deviceName: device.name,
      status: confirmed,
    }
    channel.on('izumi.status', (value) => {
      const status = value as Partial<TizenCastStatus> | null
      if (activeTizenCast === active && status?.sessionId === id && typeof status.state === 'string') {
        active.status = status as TizenCastStatus
      }
    })
    activeTizenCast = active
    return { deviceId: device.id, deviceName: device.name, backend: 'tizenReceiver' }
  } catch {
    channel.disconnect()
    return null
  }
}

export async function startDesktopCast(
  request: DesktopCastStartInput,
): Promise<Omit<DesktopCastSession, 'subtitles' | 'activeTrackIds'>> {
  const { device, ...nativeRequest } = request
  const tizen = await startTizenReceiver(device, nativeRequest)
  if (tizen) return tizen
  return invoke('desktop_cast_start', { request: nativeRequest })
}

export async function getDesktopCastStatus(includeRendering = true): Promise<DesktopCastStatus> {
  const active = activeTizenCast
  if (active) {
    if (!active.channel.connected) {
      activeTizenCast = null
      throw new Error('The Izumi TV receiver is no longer active')
    }
    active.channel.publish('izumi.control', { sessionId: active.sessionId, action: 'status' }, 'host')
    return active.status
  }
  return invoke('desktop_cast_status', { includeRendering })
}

const validDuration = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

/** Preserve the last useful clock fields when older renderers omit position fields. */
export function reconcileDesktopCastStatus(
  previous: DesktopCastStatus | null,
  next: DesktopCastStatus,
  acceptZero = false,
): DesktopCastStatus {
  const durationSeconds = validDuration(next.durationSeconds)
    ? next.durationSeconds
    : previous?.durationSeconds
  let positionSeconds = Number.isFinite(next.positionSeconds) && next.positionSeconds >= 0
    ? next.positionSeconds
    : previous?.positionSeconds ?? 0
  if (!acceptZero && positionSeconds === 0 && (previous?.positionSeconds ?? 0) > 1) {
    positionSeconds = previous!.positionSeconds
  }
  if (validDuration(durationSeconds)) positionSeconds = Math.min(positionSeconds, durationSeconds)
  return {
    ...previous,
    ...next,
    positionSeconds,
    durationSeconds,
    volume: next.volume ?? previous?.volume,
    muted: next.muted ?? previous?.muted,
  }
}

const terminalCastError = (error: unknown) =>
  /no active cast|ended|no longer active/i.test(error instanceof Error ? error.message : String(error))

export async function refreshDesktopCastStatus(includeRendering = true): Promise<DesktopCastStatus> {
  const next = await getDesktopCastStatus(includeRendering)
  let reconciled = next
  desktopCastStatus.update((previous) => (reconciled = reconcileDesktopCastStatus(previous, next)))
  return reconciled
}

function scheduleDesktopCastPoll(generation: number, delay: number) {
  if (generation !== pollGeneration) return
  pollTimer = setTimeout(() => { void pollDesktopCastStatus(generation) }, delay)
}

async function pollDesktopCastStatus(generation: number) {
  if (generation !== pollGeneration || !get(desktopCastSession)) return
  try {
    await refreshDesktopCastStatus(renderingPoll++ % 10 === 0)
    pollFailures = 0
  } catch (error) {
    if (generation !== pollGeneration) return
    pollFailures += 1
    if (terminalCastError(error) && pollFailures >= 2) {
      desktopCastSession.set(null)
      desktopCastStatus.set(null)
      return
    }
  }
  if (generation !== pollGeneration || !get(desktopCastSession)) return
  const state = get(desktopCastStatus)?.state
  const base = state === 'playing' || state === 'buffering' ? PLAYING_POLL_MS : IDLE_POLL_MS
  const backoff = pollFailures ? Math.min(4, 2 ** pollFailures) : 1
  scheduleDesktopCastPoll(generation, base * backoff)
}

export function startDesktopCastStatusPolling(seed?: DesktopCastStatus) {
  stopDesktopCastStatusPolling(false)
  if (seed) desktopCastStatus.set(seed)
  renderingPoll = 0
  pollFailures = 0
  const generation = ++pollGeneration
  void pollDesktopCastStatus(generation)
}

export function stopDesktopCastStatusPolling(clearStatus = true) {
  pollGeneration += 1
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
  if (clearStatus) desktopCastStatus.set(null)
}

export async function controlDesktopCast(request: {
  action: 'play' | 'pause' | 'seek' | 'volume' | 'tracks' | 'status'
  positionSeconds?: number
  volume?: number
  muted?: boolean
  activeTrackIds?: number[]
}): Promise<DesktopCastStatus> {
  const previous = get(desktopCastStatus)
  const seekTarget = request.action === 'seek' && Number.isFinite(request.positionSeconds)
    ? Math.max(0, request.positionSeconds!)
    : null
  if (seekTarget != null) {
    desktopCastStatus.update((status) => status && ({ ...status, positionSeconds: seekTarget }))
  }
  try {
    const active = activeTizenCast
    let next: DesktopCastStatus
    if (active) {
      active.channel.publish('izumi.control', { ...request, sessionId: active.sessionId }, 'host')
      if (request.action === 'play') active.status = { ...active.status, state: 'playing' }
      if (request.action === 'pause') active.status = { ...active.status, state: 'paused' }
      if (request.action === 'seek' && request.positionSeconds != null) {
        active.status = { ...active.status, positionSeconds: request.positionSeconds }
      }
      if (request.action === 'volume') {
        active.status = {
          ...active.status,
          volume: request.volume ?? active.status.volume,
          muted: request.muted ?? active.status.muted,
        }
      }
      next = active.status
    } else {
      next = await invoke<DesktopCastStatus>('desktop_cast_control', { request })
    }
    // DLNA renderers can briefly return the pre-seek clock after accepting Seek.
    const settled = seekTarget == null ? next : { ...next, positionSeconds: seekTarget }
    let reconciled = settled
    desktopCastStatus.update((current) => (
      reconciled = reconcileDesktopCastStatus(current, settled, seekTarget != null)
    ))
    return reconciled
  } catch (error) {
    if (seekTarget != null) desktopCastStatus.set(previous)
    throw error
  }
}

/** Route a seek only when the active cast still belongs to this player item. */
export async function seekActiveDesktopCast(
  positionSeconds: number,
  mediaId: number | null | undefined,
  episode: number | null | undefined,
): Promise<boolean> {
  if (!desktopCastSessionMatchesPlayback(get(desktopCastSession), mediaId, episode)) return false
  if (!Number.isFinite(positionSeconds)) return true
  await controlDesktopCast({ action: 'seek', positionSeconds: Math.max(0, positionSeconds) })
  return true
}

export async function stopDesktopCast(): Promise<void> {
  try {
    const active = activeTizenCast
    if (active) {
      try {
        active.channel.publish('izumi.control', { sessionId: active.sessionId, action: 'stop' }, 'host')
      } finally {
        active.channel.disconnect()
        activeTizenCast = null
      }
      return
    }
    return await invoke('desktop_cast_stop')
  } finally {
    stopDesktopCastStatusPolling()
  }
}

desktopCastSession.subscribe((session) => {
  if (!session) stopDesktopCastStatusPolling()
})
