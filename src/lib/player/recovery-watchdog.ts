export const START_TIMEOUT_MS = 60_000
export const DIRECT_TORRENT_START_TIMEOUT_MS = 40_000
export const DIRECT_TORRENT_RECOVERY_TIMEOUT_MS = 25_000
export const DIRECT_TORRENT_NO_PROGRESS_TIMEOUT_MS = 15_000
export const DIRECT_TORRENT_HARD_START_TIMEOUT_MS = 60_000
export const POSITION_EPSILON_S = 0.2

/** A full episode resolving to a tiny short is a wrong source, not a valid runtime variation.
 * The ratio and absolute-gap guards keep variable-length shows and ad-trimmed releases safe. */
export function implausiblyShortEpisode(expectedMinutes: number | null | undefined, actualSeconds: number): boolean {
  const expectedSeconds = (expectedMinutes ?? 0) * 60
  return expectedSeconds >= 10 * 60
    && Number.isFinite(actualSeconds)
    && actualSeconds > 0
    && actualSeconds < expectedSeconds * 0.35
    && expectedSeconds - actualSeconds > 8 * 60
}

/** Detect EOF that cannot be the requested episode's real end. Broken HLS sources can either
 * terminate while mpv still knows there are minutes remaining, or publish a truncated manifest
 * whose own duration ends well before AniList's runtime. Both must trigger source recovery rather
 * than auto-advancing to the next episode. */
export function prematureEof(
  position: number,
  duration: number,
  expectedMinutes?: number | null,
): boolean {
  if (!Number.isFinite(position) || position < 0) return true
  if (!Number.isFinite(duration) || duration <= 0) return position < 5
  if (duration - position > 3) return true

  const expectedSeconds = (expectedMinutes ?? 0) * 60
  return expectedSeconds >= 10 * 60
    && expectedSeconds - duration > 4 * 60
    && duration < expectedSeconds * 0.82
}

export interface RecoveryWatchState {
  loadedAt: number
  lastPosition: number
  playbackObserved: boolean
  lastNetworkBytes: number
  lastNetworkAdvancedAt: number
}

export interface TorrentDeliveryState {
  requestCount: number
  bytesInRequest: number
  totalBytes: number
}

export function resetTorrentDelivery(): TorrentDeliveryState {
  return { requestCount: 0, bytesInRequest: 0, totalBytes: 0 }
}

/** Turn the native server's per-request byte counter into a monotonic playback-delivery counter.
 * mpv replaces its head request with tail/resume ranges while probing a file, and each replacement
 * resets `streamBytesServed`. Counting positive deltas per request preserves useful progress across
 * those probes while refusing to mistake pieces merely written to the torrent cache for bytes the
 * player can actually consume. */
export function updateTorrentDelivery(
  previous: TorrentDeliveryState,
  requestCount: number,
  bytesInRequest: number,
): TorrentDeliveryState {
  const count = Number.isFinite(requestCount) ? Math.max(0, Math.floor(requestCount)) : 0
  const bytes = Number.isFinite(bytesInRequest) ? Math.max(0, bytesInRequest) : 0
  if (count < previous.requestCount) {
    return { requestCount: count, bytesInRequest: bytes, totalBytes: bytes }
  }
  if (count > previous.requestCount) {
    return {
      requestCount: count,
      bytesInRequest: bytes,
      totalBytes: previous.totalBytes + bytes,
    }
  }
  return {
    requestCount: count,
    bytesInRequest: Math.max(previous.bytesInRequest, bytes),
    totalBytes: previous.totalBytes + Math.max(0, bytes - previous.bytesInRequest),
  }
}

export interface RecoverySignal {
  now: number
  position: number
  duration: number
  paused: boolean
  // Deliberately no `buffering` signal: after playback begins, cache starvation cannot identify
  // whether the source or the client's network is at fault and must never authorize replacement.
  seeking: boolean
  eof: boolean
  firstFrame: boolean
  startTimeoutMs?: number
  networkBytes?: number
  /** Minimum average startup throughput that is worth extending beyond `startTimeoutMs`.
   * Callers normally pass a conservative fraction of the episode's average byte rate. */
  minimumStartupBytesPerSecond?: number
}

export function resetRecoveryWatch(now: number): RecoveryWatchState {
  return {
    loadedAt: now,
    lastPosition: 0,
    playbackObserved: false,
    lastNetworkBytes: 0,
    lastNetworkAdvancedAt: now,
  }
}

export function recoveryStreamKey(stream: Stream): string {
  return stream.__candidate?.routeId
    ?? stream.url
    ?? stream.infoHash?.toLocaleLowerCase()
    ?? `${stream.__origin?.kind ?? ''}:${stream.__origin?.id ?? ''}:${stream.behaviorHints?.filename ?? stream.title ?? stream.name ?? ''}`
}

/** Update startup liveness from one player sample and decide whether the load never established.
 * Deliberate pauses, seeks, EOF and any evidence of playback disarm timeout-based replacement. */
export function recoveryWatchDecision(
  previous: RecoveryWatchState,
  signal: RecoverySignal,
): { state: RecoveryWatchState; recover: boolean; reason?: 'never-started' } {
  const { now, position, duration, paused, seeking, eof, firstFrame } = signal
  const advanced = position > previous.lastPosition + POSITION_EPSILON_S
  let state = {
    ...previous,
    lastPosition: advanced ? position : Math.max(previous.lastPosition, position),
    playbackObserved: previous.playbackObserved || advanced || firstFrame,
  }
  if (signal.networkBytes != null
    && Number.isFinite(signal.networkBytes)
    && signal.networkBytes > state.lastNetworkBytes) {
    state = {
      ...state,
      lastNetworkBytes: signal.networkBytes,
      lastNetworkAdvancedAt: now,
    }
  }

  if (paused || seeking || eof || (duration > 0 && position >= duration - 3)) {
    return { state, recover: false }
  }
  // Either a presented frame or any moving playhead is evidence that playback may already have
  // begun. The frame event can be dropped by the platform, and a single position update can be a
  // resume seek, so neither proves that the SOURCE is bad when later progress stops. In that
  // ambiguous state user control wins: automatic recovery is only for a load frozen at its origin.
  const playbackConfirmed = state.playbackObserved
  if (!playbackConfirmed) {
    const startTimeout = signal.startTimeoutMs != null
      && Number.isFinite(signal.startTimeoutMs)
      && signal.startTimeoutMs > 0
      ? signal.startTimeoutMs
      : START_TIMEOUT_MS
    const startupElapsed = now - previous.loadedAt
    if (startupElapsed < startTimeout) return { state, recover: false }
    const averageStartupBytesPerSecond = signal.networkBytes != null && startupElapsed > 0
      ? signal.networkBytes / (startupElapsed / 1_000)
      : 0
    const startupThroughputViable = signal.minimumStartupBytesPerSecond == null
      || !Number.isFinite(signal.minimumStartupBytesPerSecond)
      || signal.minimumStartupBytesPerSecond <= 0
      || averageStartupBytesPerSecond >= signal.minimumStartupBytesPerSecond
    if (signal.networkBytes != null
      && startupElapsed < DIRECT_TORRENT_HARD_START_TIMEOUT_MS
      && now - state.lastNetworkAdvancedAt < DIRECT_TORRENT_NO_PROGRESS_TIMEOUT_MS
      && startupThroughputViable) {
      return { state, recover: false }
    }
    return { state, recover: true, reason: 'never-started' }
  }
  // Once playback has presented frames, a stall is not evidence that the SOURCE is bad. The same
  // paused-for-cache signal is produced by an ordinary client-side outage (weak Wi-Fi, a sleeping
  // network adapter, temporary packet loss), so using its duration to replace the source destroys
  // a healthy session and cannot fix the underlying connection. Keep buffering as player/UI state;
  // automatic replacement remains limited to loads that never established playback at all.
  return { state, recover: false }
}
import type { Stream } from '$lib/stremio/addon'
