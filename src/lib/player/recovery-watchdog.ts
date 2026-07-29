export const START_TIMEOUT_MS = 60_000
export const DIRECT_TORRENT_START_TIMEOUT_MS = 40_000
export const DIRECT_TORRENT_RECOVERY_TIMEOUT_MS = 25_000
export const DIRECT_TORRENT_NO_PROGRESS_TIMEOUT_MS = 15_000
export const DIRECT_TORRENT_HARD_START_TIMEOUT_MS = 60_000
export const STALL_TIMEOUT_MS = 25_000
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

export interface RecoveryWatchState {
  loadedAt: number
  lastAdvancedAt: number
  lastPosition: number
  lastNetworkBytes: number
  lastNetworkAdvancedAt: number
}

export interface RecoverySignal {
  now: number
  position: number
  duration: number
  paused: boolean
  buffering: boolean
  seeking: boolean
  eof: boolean
  firstFrame: boolean
  startTimeoutMs?: number
  networkBytes?: number
}

export function resetRecoveryWatch(now: number): RecoveryWatchState {
  return {
    loadedAt: now,
    lastAdvancedAt: now,
    lastPosition: 0,
    lastNetworkBytes: 0,
    lastNetworkAdvancedAt: now,
  }
}

export function recoveryStreamKey(stream: Stream): string {
  return stream.url
    ?? stream.infoHash?.toLocaleLowerCase()
    ?? `${stream.__origin?.kind ?? ''}:${stream.__origin?.id ?? ''}:${stream.behaviorHints?.filename ?? stream.title ?? stream.name ?? ''}`
}

/** Update the liveness clock from one player sample and decide whether the current source is dead.
 * Deliberate pauses, seeks, EOF and the final seconds of a file can all hold a stable position and
 * must never be mistaken for a failed stream. */
export function recoveryWatchDecision(
  previous: RecoveryWatchState,
  signal: RecoverySignal,
): { state: RecoveryWatchState; recover: boolean; reason?: 'never-started' | 'stalled' } {
  const { now, position, duration, paused, seeking, eof, firstFrame } = signal
  const advanced = position > previous.lastPosition + POSITION_EPSILON_S
  let state = advanced
    ? { ...previous, lastAdvancedAt: now, lastPosition: position }
    : { ...previous, lastPosition: Math.max(previous.lastPosition, position) }
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
    return { state: { ...state, lastAdvancedAt: now }, recover: false }
  }
  if (!firstFrame) {
    const startTimeout = signal.startTimeoutMs != null
      && Number.isFinite(signal.startTimeoutMs)
      && signal.startTimeoutMs > 0
      ? signal.startTimeoutMs
      : START_TIMEOUT_MS
    const startupElapsed = now - previous.loadedAt
    if (startupElapsed < startTimeout) return { state, recover: false }
    if (signal.networkBytes != null
      && startupElapsed < DIRECT_TORRENT_HARD_START_TIMEOUT_MS
      && now - state.lastNetworkAdvancedAt < DIRECT_TORRENT_NO_PROGRESS_TIMEOUT_MS) {
      return { state, recover: false }
    }
    return { state, recover: true, reason: 'never-started' }
  }
  return now - state.lastAdvancedAt >= STALL_TIMEOUT_MS
    ? { state, recover: true, reason: 'stalled' }
    : { state, recover: false }
}
import type { Stream } from '$lib/stremio/addon'
