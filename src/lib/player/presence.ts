/** What the desktop backend is told about playback, so the OS media panel (MPRIS on Linux, SMTC
 *  on Windows) and Discord Rich Presence can publish it. The throttle lives here rather than in
 *  the player overlay so it can be tested without a running player. */
export interface PresencePayload {
  title: string
  series: string
  episode: number | null
  duration: number
  position: number
  paused: boolean
  coverUrl: string | null
  systemControls: boolean
  discord: boolean
  /** Adult title: the backend withholds the name and artwork from BOTH sinks, not just Discord. */
  private: boolean
  /** The player's own seek step, so the panel's coarse seek moves by the same amount. */
  seekSeconds: number
}

/** How often a position-only change may cross the native boundary. Progress ticks arrive several
 *  times a second and each one is a D-Bus message / SMTC update; ~1 Hz keeps the playhead honest
 *  without hammering either. Everything that isn't the playhead goes out immediately. */
export const PRESENCE_POSITION_INTERVAL_MS = 1000

export interface PresenceThrottleState {
  signature: string
  sentAt: number
}

/** Everything except the playhead. A change here — play/pause, a new episode, either settings
 *  toggle, the privacy flag, a new seek step — is state the panel and Discord must reflect at
 *  once, so it skips the rate limit. */
export function presenceSignature(payload: PresencePayload): string {
  return [
    payload.title,
    payload.series,
    payload.episode ?? '',
    payload.paused ? 'paused' : 'playing',
    Math.round(payload.duration),
    payload.coverUrl ?? '',
    payload.systemControls ? '1' : '0',
    payload.discord ? '1' : '0',
    payload.private ? '1' : '0',
    payload.seekSeconds,
  ].join('|')
}

export interface PresenceDecision {
  send: boolean
  /** ms to wait before this payload may go out; only meaningful when `send` is false. */
  waitMs: number
  state: PresenceThrottleState
}

/** Decide whether `payload` goes out now or waits out the position rate limit. */
export function presenceDecision(
  state: PresenceThrottleState | null,
  payload: PresencePayload,
  now: number,
): PresenceDecision {
  const signature = presenceSignature(payload)
  const elapsed = state ? now - state.sentAt : Infinity
  // A backwards clock (suspend/resume, NTP step) must not park the playhead forever.
  if (!state || state.signature !== signature || elapsed >= PRESENCE_POSITION_INTERVAL_MS || elapsed < 0) {
    return { send: true, waitMs: 0, state: { signature, sentAt: now } }
  }
  return { send: false, waitMs: PRESENCE_POSITION_INTERVAL_MS - elapsed, state }
}
