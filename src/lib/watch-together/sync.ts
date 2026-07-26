// Clock, drift and buffer math for Watch Together. Kept pure (no Tauri, no stores) so the
// correctness-critical parts are unit-testable.
//
// Why the clock handshake exists: the room exchange is a shared document, not a request/response
// channel, so a guest that compares its own `Date.now()` against the host's `sentAt` turns any
// clock skew between the two machines into a permanent, non-converging seek error — a laptop four
// seconds off never settles, it re-seeks on every heartbeat forever. Measure the offset first, then
// extrapolate against the host's clock instead of the local one.

/** One usable round-trip measurement.
 *
 *  Accuracy note: this rides a polled shared document, not a socket, so each leg carries up to a
 *  full heartbeat of polling delay on top of the network. The offset error is half the difference
 *  between the two legs, which is why `bestOffsetMs` selects on the lowest total delay rather than
 *  averaging — the tightest sample is the one where neither poll happened to be unlucky. Expect
 *  low-hundreds-of-milliseconds accuracy, comfortably inside the 0.8s in-sync band, against an
 *  uncorrected error that is unbounded (machine clock skew is routinely seconds). */
export interface ClockSample {
  /** hostClock - localClock, milliseconds. Add to a local timestamp to get the host's. */
  offsetMs: number
  /** Total propagation delay both ways, with the host's hold time removed. Lower = more trustworthy. */
  rttMs: number
  at: number
}

/** Guest -> host. Published in the guest's own record and answered on a later heartbeat. */
export interface ClockPing { id: string; t0: number }
/** Host -> guest, keyed by the guest's deviceId.
 *  `t1` is when the host READ the ping, `t2` when it PUBLISHED the answer. */
export interface ClockPong { id: string; t0: number; t1: number; t2: number }

export const MAX_CLOCK_SAMPLES = 8
export const SAMPLE_TTL_MS = 120_000
/** Above this the sample is noise (a stalled exchange, a suspended tab) and tells us nothing. */
export const MAX_PLAUSIBLE_RTT_MS = 5_000

/** Four-timestamp NTP offset.
 *
 *  t0 guest sent the ping · t1 host read it · t2 host published the pong · t3 guest read the pong.
 *
 *  Splitting the host's read and publish stamps is the load-bearing part: the pong rides the NEXT
 *  heartbeat, so `t2 - t1` is routinely most of a second. A three-timestamp form would fold that
 *  queueing delay straight into the offset and bias every guest late by half a heartbeat. */
export function clockSample(t0: number, t1: number, t2: number, t3: number): ClockSample | null {
  if (![t0, t1, t2, t3].every((v) => Number.isFinite(v))) return null
  const rttMs = (t3 - t0) - (t2 - t1)
  if (rttMs < 0 || rttMs > MAX_PLAUSIBLE_RTT_MS) return null
  return { offsetMs: ((t1 - t0) + (t2 - t3)) / 2, rttMs, at: t3 }
}

/** Keep a small window of recent samples, newest last. */
export function pushSample(samples: ClockSample[], sample: ClockSample | null, now: number): ClockSample[] {
  if (!sample) return samples.filter((s) => now - s.at < SAMPLE_TTL_MS)
  return [...samples, sample].filter((s) => now - s.at < SAMPLE_TTL_MS).slice(-MAX_CLOCK_SAMPLES)
}

/** Offset of the lowest-RTT sample in the window, or 0 when we have never measured.
 *
 *  Min-RTT rather than a mean or EWMA: a delayed exchange only ever moves the apparent offset in
 *  one direction, so averaging drags the estimate toward the noise, while the least-delayed sample
 *  is the least contaminated one. Zero is the correct no-data answer — it degrades to exactly the
 *  old behaviour, which is also what happens against a host too old to answer pings. */
export function bestOffsetMs(samples: ClockSample[], now: number): number {
  const live = samples.filter((s) => now - s.at < SAMPLE_TTL_MS)
  if (!live.length) return 0
  return live.reduce((best, s) => (s.rttMs < best.rttMs ? s : best)).offsetMs
}

// --- Drift ---------------------------------------------------------------------------------

/** Below this we are in sync; never seek. Under a second of drift is not visible against the
 *  discussion the room is having, and correcting it costs a re-buffer on a torrent source. */
export const IN_SYNC_S = 0.8
/** A seek this far out has to persist for two consecutive samples before we act on it, so one
 *  jittery position report from a stalling source doesn't yank the playhead. */
export const DRIFT_SEEK_S = 1.5
/** Beyond this, correct immediately — the guest is watching a different scene. */
export const DRIFT_HARD_S = 3.0
/** While paused there is no playback to hide a correction, so hold a tighter line. */
export const PAUSED_SEEK_S = 0.7
export const SEEK_COOLDOWN_MS = 1_000
/** After our own seek, ignore drift entirely until the player has settled. Without this the seek's
 *  own position report reads back as fresh drift and the guest oscillates — the same failure
 *  Syncplay's `ignoringOnTheFly` counters exist to prevent. */
export const SEEK_SETTLE_MS = 1_500

export interface DriftInput {
  localPosition: number
  localPaused: boolean
  /** Host position already extrapolated to now via `hostPositionNow`. */
  hostPosition: number
  hostPaused: boolean
  now: number
  /** When we last issued a corrective seek (0 = never). */
  lastSeekAt: number
  /** Consecutive samples already seen above DRIFT_SEEK_S. */
  streak: number
}

export interface DriftDecision {
  /** Absolute position to seek to, or null to leave the playhead alone. */
  seekTo: number | null
  /** Pause state to apply, or null when it already matches. */
  setPaused: boolean | null
  /** Carry back into the next call. */
  streak: number
}

/** Decide what a guest should do with one host state sample.
 *
 *  Deliberately NOT implemented as a playback-rate nudge (speed up slightly to close a small gap,
 *  the way some sync clients do): mpv exposes `speed` as one global property and izumi already
 *  hands it to the user in the player controls, so a sync nudge would silently overwrite a setting
 *  the user chose and there is no way to tell the two apart afterwards. A threshold ladder with
 *  hysteresis costs one extra seek and touches nothing the user owns. */
export function driftDecision(input: DriftInput): DriftDecision {
  const { localPosition, localPaused, hostPosition, hostPaused, now, lastSeekAt, streak } = input
  const setPaused = localPaused === hostPaused ? null : hostPaused
  const settling = lastSeekAt > 0 && now - lastSeekAt < SEEK_SETTLE_MS
  if (settling) return { seekTo: null, setPaused, streak: 0 }

  const drift = Math.abs(localPosition - hostPosition)
  const threshold = hostPaused ? PAUSED_SEEK_S : DRIFT_SEEK_S
  if (drift <= IN_SYNC_S || drift <= threshold) return { seekTo: null, setPaused, streak: 0 }

  // One sample is enough once we are visibly out; otherwise require it to persist.
  const next = streak + 1
  if (!hostPaused && drift < DRIFT_HARD_S && next < 2) return { seekTo: null, setPaused, streak: next }
  if (lastSeekAt > 0 && now - lastSeekAt < SEEK_COOLDOWN_MS) return { seekTo: null, setPaused, streak: next }
  return { seekTo: hostPosition, setPaused, streak: 0 }
}

/** Where the host's playhead is *now*, on our clock, given the measured offset.
 *  Paused states are not extrapolated. Clamped to the file so a stale record can't seek past EOF. */
export function hostPositionNow(
  playback: { position: number; duration: number; paused: boolean; sentAt: number },
  offsetMs: number,
  now: number,
): number {
  if (playback.paused) return Math.max(0, playback.position)
  const hostNow = now + offsetMs
  const elapsed = Math.max(0, (hostNow - playback.sentAt) / 1000)
  const target = playback.position + elapsed
  return Math.max(0, playback.duration > 0 ? Math.min(playback.duration, target) : target)
}

// --- Buffer gate ---------------------------------------------------------------------------

/** Longest the room waits on one stalling peer before carrying on without them. izumi plays from
 *  torrents and debrid, i.e. the highest-stall-probability sources of any client in this class, so
 *  an unbounded hold would let one dead swarm freeze everyone else indefinitely. */
export const BUFFER_HOLD_MAX_MS = 20_000

export interface GateState { holdingSince: number | null }
export interface GateDecision {
  state: GateState
  /** Pause state the host should apply to its own player, or null to leave it alone. */
  setPaused: boolean | null
  /** Message for the party UI ('' = nothing to say). */
  notice: string
}

/** Host-side: hold the room while any peer is buffering, and let go again.
 *
 *  Never fights the user — if the host's own pause state stops matching the hold, the user has
 *  taken over and the gate steps aside instead of re-pausing them. */
export function bufferGateDecision(
  prev: GateState,
  opts: { anyBuffering: boolean; hostPaused: boolean; now: number },
): GateDecision {
  const { anyBuffering, hostPaused, now } = opts
  const clear: GateState = { holdingSince: null }

  if (prev.holdingSince == null) {
    if (!anyBuffering || hostPaused) return { state: clear, setPaused: null, notice: '' }
    return { state: { holdingSince: now }, setPaused: true, notice: 'Waiting for someone to buffer…' }
  }

  // The hold paused the host; if it is playing again the user overrode us. Stand down.
  if (!hostPaused) return { state: clear, setPaused: null, notice: '' }
  if (!anyBuffering) return { state: clear, setPaused: false, notice: '' }
  if (now - prev.holdingSince >= BUFFER_HOLD_MAX_MS) {
    return { state: clear, setPaused: false, notice: 'Carried on without a peer that kept buffering.' }
  }
  return { state: prev, setPaused: null, notice: 'Waiting for someone to buffer…' }
}
