export const START_TIMEOUT_MS = 60_000
export const STALL_TIMEOUT_MS = 25_000
export const POSITION_EPSILON_S = 0.2

export interface RecoveryWatchState {
  loadedAt: number
  lastAdvancedAt: number
  lastPosition: number
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
}

export function resetRecoveryWatch(now: number): RecoveryWatchState {
  return { loadedAt: now, lastAdvancedAt: now, lastPosition: 0 }
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
  const state = advanced
    ? { ...previous, lastAdvancedAt: now, lastPosition: position }
    : { ...previous, lastPosition: Math.max(previous.lastPosition, position) }

  if (paused || seeking || eof || (duration > 0 && position >= duration - 3)) {
    return { state: { ...state, lastAdvancedAt: now }, recover: false }
  }
  if (!firstFrame) {
    return now - previous.loadedAt >= START_TIMEOUT_MS
      ? { state, recover: true, reason: 'never-started' }
      : { state, recover: false }
  }
  return now - state.lastAdvancedAt >= STALL_TIMEOUT_MS
    ? { state, recover: true, reason: 'stalled' }
    : { state, recover: false }
}
import type { Stream } from '$lib/stremio/addon'
