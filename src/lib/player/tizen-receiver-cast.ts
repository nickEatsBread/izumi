import { invoke } from '@tauri-apps/api/core'
import {
  IZUMI_TIZEN_APPLICATION_ID,
  IZUMI_TIZEN_CHANNEL,
  SamsungSmartViewChannel,
} from './samsung-smart-view'
import type { CompanionMedia, CompanionSkipSegment } from '$lib/companion/protocol'
import type { CastTrackHints, CastTrackPreferences } from './android-cast'

export interface TizenReceiverDevice {
  id: string
  name: string
  address: string
}

export interface CastSubtitleStyle {
  enabled: boolean
  scope: 'dialogue' | 'all'
  font: string
  bold: boolean
  fontSize: number
  textColor: string
  borderColor: string
  borderSize: number
  shadow: number
  position: number
}

export interface TizenReceiverStatus {
  sessionId: string
  state: 'playing' | 'paused' | 'buffering' | 'idle'
  positionSeconds: number
  durationSeconds?: number
  volume?: number
  muted?: boolean
  subtitleState?: 'off' | 'loading' | 'ready' | 'error'
  subtitleTitle?: string
  activeTrackIds?: number[]
  subtitleError?: string
  error?: string
}

export interface TizenReceiverLoad {
  url: string
  title?: string
  contentRating?: string
  contentType: string
  positionSeconds: number
  subtitles: { url: string; lang?: string; title?: string; contentType: string }[]
  activeTrackIds: number[]
  /** Exact title/episode owning this source. The TV must not use its last browsed card when asking
   * a linked device for a replacement. */
  media?: CompanionMedia
  /** Provider-normalized timing; the TV never needs direct AniSkip or IntroDB access. */
  skipSegments?: CompanionSkipSegment[]
  /** Track indexes are container-local, so send descriptive preferences for the TV to match. */
  trackPreferences?: CastTrackPreferences
  /** Sender-resolved names for embedded tracks whose container labels Samsung may discard. */
  trackHints?: CastTrackHints
  subtitleStyle?: CastSubtitleStyle
  adaptive?: {
    minBitrateKbps?: number
    maxBitrateKbps?: number
    startBitrate?: 'LOWEST' | 'AVERAGE' | 'HIGHEST' | number
  }
  drm?: {
    system: 'playready' | 'widevine'
    licenseServer: string
    headers?: Record<string, string>
    customData?: string
    deleteLicenseAfterUse?: boolean
  }
  cookies?: string
  userAgent?: string
}

type ActiveReceiver = {
  channel: SamsungSmartViewChannel
  sessionId: string
  device: TizenReceiverDevice
  status: TizenReceiverStatus
  pendingSeek: { positionSeconds: number; expiresAt: number } | null
  stopConnectionListener: (() => void) | null
  stopReceiverListener: (() => void) | null
}

let active: ActiveReceiver | null = null
const statusListeners = new Set<(status: TizenReceiverStatus) => void>()
const relayForegroundOwners = new Map<string, string | undefined>()

/**
 * Android may freeze the Rust HTTP relay after Izumi leaves the foreground. Keep it alive only
 * while a TV is consuming a phone-hosted URL. The desktop plugin deliberately implements this
 * command as a no-op.
 */
export async function setTizenReceiverRelayForeground(
  active: boolean,
  title?: string,
  owner = 'cast',
): Promise<void> {
  if (active) relayForegroundOwners.set(owner, title)
  else relayForegroundOwners.delete(owner)
  const activeTitles = [...relayForegroundOwners.values()].filter((value): value is string => Boolean(value))
  try {
    await invoke('plugin:extplayer|companion_cast_foreground', {
      payload: {
        active: relayForegroundOwners.size > 0,
        title: relayForegroundOwners.size ? activeTitles[activeTitles.length - 1] : undefined,
      },
    })
  } catch {
    // Browser previews and older app builds do not expose the native lifecycle command.
  }
}

function emitStatus(status: TizenReceiverStatus) {
  for (const listener of [...statusListeners]) {
    try { listener(status) } catch { /* one observer must not break the receiver channel */ }
  }
}

export function subscribeTizenReceiverStatus(
  listener: (status: TizenReceiverStatus) => void,
): () => void {
  statusListeners.add(listener)
  if (active) listener(active.status)
  return () => statusListeners.delete(listener)
}

const newSessionId = () => globalThis.crypto?.randomUUID?.()
  ?? `izumi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

export async function probeTizenReceiver(device: TizenReceiverDevice, senderName = 'Izumi'): Promise<boolean> {
  const channel = new SamsungSmartViewChannel(device.address, { name: senderName })
  try {
    await channel.connect()
    return await channel.waitForReceiver()
  } catch {
    return false
  } finally {
    channel.disconnect()
  }
}

export async function startTizenReceiverCast(
  device: TizenReceiverDevice,
  request: TizenReceiverLoad,
  senderName = 'Izumi',
): Promise<TizenReceiverStatus> {
  // Replacing a sender-side session must stop the old item without closing the TV application
  // that is about to accept the replacement load.
  await stopTizenReceiverCast(false).catch(() => {})
  const channel = new SamsungSmartViewChannel(
    device.address,
    { name: senderName },
    IZUMI_TIZEN_CHANNEL,
    IZUMI_TIZEN_APPLICATION_ID,
  )
  await channel.connect(5_000)
  // A cold Tizen web application takes materially longer than an already-open channel to load.
  if (!await channel.waitForReceiver(12_000)) {
    channel.disconnect()
    throw new Error('izumi Companion is installed, but the TV could not open it')
  }

  const sessionId = newSessionId()
  const confirmed = await new Promise<TizenReceiverStatus>((resolve, reject) => {
    const timer = setTimeout(() => {
      off()
      reject(new Error('izumi Companion did not accept playback'))
    }, 5_000)
    const off = channel.on('izumi.status', (value) => {
      const status = value as Partial<TizenReceiverStatus> | null
      if (!status || status.sessionId !== sessionId || typeof status.state !== 'string') return
      clearTimeout(timer)
      off()
      if (status.error) reject(new Error(status.error))
      else resolve(status as TizenReceiverStatus)
    })
    // Older TV firmware may deliver a channel event without resolving its `from` peer. Carry the
    // authenticated channel identity in the payload so the receiver can still reply to this socket.
    channel.publish('izumi.load', { ...request, sessionId, senderId: channel.clientId }, 'host')
  }).catch((error) => {
    channel.disconnect()
    throw error
  })

  const receiver: ActiveReceiver = {
    channel,
    sessionId,
    device,
    status: confirmed,
    pendingSeek: null,
    stopConnectionListener: null,
    stopReceiverListener: null,
  }
  channel.on('izumi.status', (value) => {
    const status = value as Partial<TizenReceiverStatus> | null
    if (active === receiver && status?.sessionId === sessionId && typeof status.state === 'string') {
      let next = status as TizenReceiverStatus
      if (receiver.pendingSeek) {
        const reachedTarget = Math.abs(next.positionSeconds - receiver.pendingSeek.positionSeconds) <= 2
        if (reachedTarget || next.error || next.state === 'idle' || Date.now() >= receiver.pendingSeek.expiresAt) {
          receiver.pendingSeek = null
        } else {
          next = { ...next, positionSeconds: receiver.pendingSeek.positionSeconds }
        }
      }
      receiver.status = next
      emitStatus(next)
      // A buffering error can be followed by AVPlay's in-place retry. Stopping Android's relay
      // here severs the media/subtitle URL during that recovery and makes the TV appear to have
      // disconnected. The explicit idle/stop path owns relay teardown.
      if (next.state === 'idle') void setTizenReceiverRelayForeground(false)
    }
  })
  const resume = () => {
    if (active !== receiver) return
    void channel.waitForReceiver(12_000).then((available) => {
      if (!available || active !== receiver || !channel.connected) return
      channel.publish('izumi.resume', {
        sessionId,
        senderId: channel.clientId,
      }, 'host')
    }).catch(() => {})
  }
  receiver.stopConnectionListener = channel.onConnected((reconnected) => {
    if (reconnected) resume()
  })
  receiver.stopReceiverListener = channel.onReceiverConnected(resume)
  active = receiver
  emitStatus(confirmed)
  return confirmed
}

export function hasActiveTizenReceiverCast(): boolean {
  return active != null
}

export function getTizenReceiverStatus(): TizenReceiverStatus {
  if (!active) throw new Error('The Izumi TV receiver is no longer active')
  if (!active.channel.connected) throw new Error('The Izumi TV receiver is reconnecting')
  active.channel.publish('izumi.control', {
    sessionId: active.sessionId,
    senderId: active.channel.clientId,
    action: 'status',
  }, 'host')
  return active.status
}

export function controlTizenReceiver(request: {
  action: 'play' | 'pause' | 'seek' | 'volume' | 'tracks' | 'status'
  positionSeconds?: number
  volume?: number
  muted?: boolean
  activeTrackIds?: number[]
}): TizenReceiverStatus {
  const receiver = active
  if (!receiver) throw new Error('No active Izumi TV receiver')
  if (!receiver.channel.connected) throw new Error('The Izumi TV receiver is reconnecting')
  let payload = request
  let seekTarget: number | null = null
  if (request.action === 'seek' && request.positionSeconds != null) {
    const duration = receiver.status.durationSeconds
    seekTarget = Math.max(0, typeof duration === 'number' && Number.isFinite(duration) && duration > 0
      ? Math.min(duration, request.positionSeconds)
      : request.positionSeconds)
    payload = { ...request, positionSeconds: seekTarget }
    receiver.pendingSeek = {
      positionSeconds: seekTarget,
      expiresAt: Date.now() + 5_000,
    }
  }
  receiver.channel.publish('izumi.control', {
    ...payload,
    sessionId: receiver.sessionId,
    senderId: receiver.channel.clientId,
  }, 'host')
  if (request.action === 'play') receiver.status = { ...receiver.status, state: 'playing' }
  if (request.action === 'pause') receiver.status = { ...receiver.status, state: 'paused' }
  if (seekTarget != null) {
    receiver.status = { ...receiver.status, positionSeconds: seekTarget }
  }
  if (request.action === 'tracks') {
    receiver.status = { ...receiver.status, activeTrackIds: request.activeTrackIds ?? [] }
  }
  if (request.action === 'volume') {
    receiver.status = {
      ...receiver.status,
      volume: request.volume ?? receiver.status.volume,
      muted: request.muted ?? receiver.status.muted,
    }
  }
  emitStatus(receiver.status)
  return receiver.status
}

/**
 * End the sender session. User-initiated stops also close the TV application; transient channel
 * loss does neither, and the channel's normal reconnect path simply reattaches to TV playback.
 */
export async function stopTizenReceiverCast(exitTvApp = true): Promise<void> {
  const receiver = active
  if (!receiver) {
    await setTizenReceiverRelayForeground(false)
    return
  }
  active = null
  receiver.stopConnectionListener?.()
  receiver.stopReceiverListener?.()
  try {
    // If the user presses Stop during a brief channel interruption, make one bounded attempt to
    // deliver their explicit intent instead of silently abandoning the controller session.
    if (exitTvApp && !receiver.channel.connected) {
      try {
        await receiver.channel.connect(2_500)
        await receiver.channel.waitForReceiver(2_500)
      } catch { /* The TV may genuinely be offline; local cleanup must still complete. */ }
    }
    if (receiver.channel.connected) {
      receiver.channel.publish('izumi.control', {
        sessionId: receiver.sessionId,
        senderId: receiver.channel.clientId,
        action: 'stop',
        exitApp: exitTvApp,
      }, 'host')
    }
  } finally {
    receiver.channel.disconnect()
    await setTizenReceiverRelayForeground(false)
  }
}
