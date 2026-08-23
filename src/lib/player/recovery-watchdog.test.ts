import { describe, expect, it } from 'vitest'
import {
  DIRECT_TORRENT_START_TIMEOUT_MS,
  DIRECT_TORRENT_HARD_START_TIMEOUT_MS,
  DIRECT_TORRENT_NO_PROGRESS_TIMEOUT_MS,
  START_TIMEOUT_MS,
  STALL_TIMEOUT_MS,
  implausiblyShortEpisode,
  prematureEof,
  recoveryWatchDecision,
  resetRecoveryWatch,
  resetTorrentDelivery,
  updateTorrentDelivery,
} from './recovery-watchdog'

describe('implausiblyShortEpisode', () => {
  it('flags a two-minute mini-episode returned for a 24-minute show', () => {
    expect(implausiblyShortEpisode(24, 125.248)).toBe(true)
  })

  it('allows ordinary runtime variation and unknown runtimes', () => {
    expect(implausiblyShortEpisode(24, 1_260)).toBe(false)
    expect(implausiblyShortEpisode(undefined, 125)).toBe(false)
    expect(implausiblyShortEpisode(5, 120)).toBe(false)
  })
})

describe('prematureEof', () => {
  it('rejects a source that ends before producing playable media', () => {
    expect(prematureEof(0, 0)).toBe(true)
    expect(prematureEof(0, 1_470)).toBe(true)
  })

  it('allows EOF at the real end of a file', () => {
    expect(prematureEof(1_469, 1_470)).toBe(false)
    expect(prematureEof(2, 2)).toBe(false)
  })
})

const signal = (now: number, extra: Partial<Parameters<typeof recoveryWatchDecision>[1]> = {}) => ({
  now,
  position: 0,
  duration: 1_400,
  paused: false,
  buffering: false,
  seeking: false,
  eof: false,
  firstFrame: false,
  ...extra,
})

describe('playback recovery watchdog', () => {
  it('recovers a source that never presents a frame', () => {
    const state = resetRecoveryWatch(1_000)
    expect(recoveryWatchDecision(state, signal(1_000 + START_TIMEOUT_MS - 1)).recover).toBe(false)
    expect(recoveryWatchDecision(state, signal(1_000 + START_TIMEOUT_MS)).reason).toBe('never-started')
  })

  it('uses a shorter startup deadline supplied by direct P2P playback', () => {
    const state = resetRecoveryWatch(1_000)
    expect(recoveryWatchDecision(state, signal(1_000 + DIRECT_TORRENT_START_TIMEOUT_MS - 1, {
      startTimeoutMs: DIRECT_TORRENT_START_TIMEOUT_MS,
    })).recover).toBe(false)
    expect(recoveryWatchDecision(state, signal(1_000 + DIRECT_TORRENT_START_TIMEOUT_MS, {
      startTimeoutMs: DIRECT_TORRENT_START_TIMEOUT_MS,
    })).reason).toBe('never-started')
  })

  it('does not fail direct P2P while the selected file is still downloading', () => {
    let state = resetRecoveryWatch(1_000)
    ;({ state } = recoveryWatchDecision(state, signal(
      1_000 + DIRECT_TORRENT_START_TIMEOUT_MS,
      {
        startTimeoutMs: DIRECT_TORRENT_START_TIMEOUT_MS,
        networkBytes: 100_000_000,
      },
    )))
    expect(recoveryWatchDecision(state, signal(
      1_000 + DIRECT_TORRENT_START_TIMEOUT_MS + DIRECT_TORRENT_NO_PROGRESS_TIMEOUT_MS - 1,
      {
        startTimeoutMs: DIRECT_TORRENT_START_TIMEOUT_MS,
        networkBytes: 100_000_000,
      },
    )).recover).toBe(false)
  })

  it('does not mistake an unusably slow trickle for healthy P2P startup', () => {
    const state = resetRecoveryWatch(1_000)
    expect(recoveryWatchDecision(state, signal(
      1_000 + DIRECT_TORRENT_START_TIMEOUT_MS,
      {
        startTimeoutMs: DIRECT_TORRENT_START_TIMEOUT_MS,
        networkBytes: 4_000_000,
        minimumStartupBytesPerSecond: 500_000,
      },
    )).reason).toBe('never-started')
  })

  it('fails direct P2P after download activity stops or the hard deadline is reached', () => {
    let state = resetRecoveryWatch(1_000)
    ;({ state } = recoveryWatchDecision(state, signal(
      1_000 + DIRECT_TORRENT_START_TIMEOUT_MS,
      {
        startTimeoutMs: DIRECT_TORRENT_START_TIMEOUT_MS,
        networkBytes: 100_000_000,
      },
    )))
    expect(recoveryWatchDecision(state, signal(
      1_000 + DIRECT_TORRENT_START_TIMEOUT_MS + DIRECT_TORRENT_NO_PROGRESS_TIMEOUT_MS,
      {
        startTimeoutMs: DIRECT_TORRENT_START_TIMEOUT_MS,
        networkBytes: 100_000_000,
      },
    )).reason).toBe('never-started')
    expect(recoveryWatchDecision(state, signal(
      1_000 + DIRECT_TORRENT_HARD_START_TIMEOUT_MS,
      {
        startTimeoutMs: DIRECT_TORRENT_START_TIMEOUT_MS,
        networkBytes: 200_000_000,
      },
    )).reason).toBe('never-started')
  })

  it('recovers playback that stops advancing after a first frame', () => {
    let state = resetRecoveryWatch(1_000)
    ;({ state } = recoveryWatchDecision(state, signal(2_000, { firstFrame: true, position: 10 })))
    ;({ state } = recoveryWatchDecision(state, signal(3_000, {
      firstFrame: true,
      position: 10,
      buffering: true,
    })))
    expect(recoveryWatchDecision(state, signal(3_000 + STALL_TIMEOUT_MS, {
      firstFrame: true,
      position: 10,
      buffering: true,
    })).reason).toBe('stalled')
  })

  it('never force-switches a playing source merely because UI position telemetry is stale', () => {
    let state = resetRecoveryWatch(1_000)
    ;({ state } = recoveryWatchDecision(state, signal(2_000, { firstFrame: true, position: 10 })))
    const delayed = recoveryWatchDecision(state, signal(2_000 + STALL_TIMEOUT_MS * 4, {
      firstFrame: true,
      position: 10,
      buffering: false,
    }))
    expect(delayed.recover).toBe(false)
    expect(delayed.state.bufferingSince).toBeNull()
  })

  it('treats repeated clock advancement as playback even when the first-frame event was lost', () => {
    let state = resetRecoveryWatch(1_000)
    ;({ state } = recoveryWatchDecision(state, signal(2_000, { position: 47 })))
    ;({ state } = recoveryWatchDecision(state, signal(3_000, { position: 48 })))
    const delayed = recoveryWatchDecision(state, signal(3_000 + START_TIMEOUT_MS * 2, {
      position: 48,
      buffering: false,
      startTimeoutMs: DIRECT_TORRENT_START_TIMEOUT_MS,
    }))
    expect(delayed.recover).toBe(false)
    expect(delayed.state.positionAdvanceCount).toBe(2)
  })

  it('does not call a buffering torrent stalled while its server is still delivering bytes', () => {
    let state = resetRecoveryWatch(1_000)
    ;({ state } = recoveryWatchDecision(state, signal(2_000, {
      firstFrame: true,
      position: 10,
      buffering: true,
      networkBytes: 1_000_000,
    })))
    const active = recoveryWatchDecision(state, signal(2_000 + STALL_TIMEOUT_MS, {
      firstFrame: true,
      position: 10,
      buffering: true,
      networkBytes: 2_000_000,
    }))
    expect(active.recover).toBe(false)
    expect(active.state.bufferingSince).toBeNull()
  })

  it('never recovers a deliberate pause, seek, EOF, or final frame', () => {
    const state = resetRecoveryWatch(1_000)
    const now = 1_000 + STALL_TIMEOUT_MS * 2
    for (const extra of [
      { paused: true },
      { seeking: true },
      { eof: true },
      { firstFrame: true, position: 1_399 },
    ]) {
      expect(recoveryWatchDecision(state, signal(now, { firstFrame: true, ...extra })).recover).toBe(false)
    }
  })

  it('resets the stall clock whenever position advances', () => {
    let state = resetRecoveryWatch(1_000)
    ;({ state } = recoveryWatchDecision(state, signal(20_000, { firstFrame: true, position: 30 })))
    expect(state.lastAdvancedAt).toBe(20_000)
    expect(recoveryWatchDecision(state, signal(20_000 + STALL_TIMEOUT_MS - 1, {
      firstFrame: true,
      position: 30,
    })).recover).toBe(false)
  })

  it('never recovers a stream whose position is advancing, even with the frame flag lost', () => {
    // The flag rides a presentation event that can be lost (Android PLAYBACK_RESTART). A healthy
    // torrent then sat in the never-started branch forever and recovery fired on every
    // startup-timeout lap — "P2P source is too slow" while playback was visibly fine.
    let state = resetRecoveryWatch(1_000)
    for (let tick = 1; tick <= 90; tick++) {
      const now = 1_000 + tick * 1_000
      const decision = recoveryWatchDecision(state, signal(now, {
        firstFrame: false,
        position: tick, // the clock is moving one second per tick
        networkBytes: 0, // fully-downloaded torrent: no new bytes this session
        startTimeoutMs: DIRECT_TORRENT_START_TIMEOUT_MS,
        minimumStartupBytesPerSecond: 100_000,
      }))
      state = decision.state
      expect(decision.recover).toBe(false)
    }
  })

  it('still recovers a frameless stream frozen at a nonzero position', () => {
    // Loaded at a resume offset, clock never moves: the advancing-clock guard lapses after the
    // stall window and the startup timeout takes over as before.
    let state = resetRecoveryWatch(1_000)
    ;({ state } = recoveryWatchDecision(state, signal(2_000, { position: 47.3 })))
    const later = 2_000 + Math.max(STALL_TIMEOUT_MS, START_TIMEOUT_MS)
    expect(recoveryWatchDecision(state, signal(later, { position: 47.3 })).recover).toBe(true)
  })

  it('keeps the plain never-started timeout for a stream stuck at zero', () => {
    const state = resetRecoveryWatch(1_000)
    const decision = recoveryWatchDecision(state, signal(1_000 + START_TIMEOUT_MS, { position: 0 }))
    expect(decision.recover).toBe(true)
    expect(decision.reason).toBe('never-started')
  })
})

describe('direct torrent stream delivery', () => {
  it('accumulates bytes across mpv head, tail, and resume requests', () => {
    let state = resetTorrentDelivery()
    state = updateTorrentDelivery(state, 1, 64_000)
    state = updateTorrentDelivery(state, 1, 96_000)
    state = updateTorrentDelivery(state, 2, 16_000)
    state = updateTorrentDelivery(state, 3, 128_000)
    expect(state.totalBytes).toBe(240_000)
  })

  it('does not double-count an unchanged request snapshot', () => {
    let state = updateTorrentDelivery(resetTorrentDelivery(), 1, 64_000)
    state = updateTorrentDelivery(state, 1, 64_000)
    expect(state.totalBytes).toBe(64_000)
  })

  it('resets safely when native playback diagnostics restart', () => {
    let state = updateTorrentDelivery(resetTorrentDelivery(), 4, 512_000)
    state = updateTorrentDelivery(state, 1, 32_000)
    expect(state).toEqual({ requestCount: 1, bytesInRequest: 32_000, totalBytes: 32_000 })
  })

  it('rejects EOF while the player still reports minutes remaining', () => {
    expect(prematureEof(18 * 60, 24 * 60, 24)).toBe(true)
  })

  it('rejects a truncated manifest but allows ordinary runtime variation', () => {
    expect(prematureEof(18 * 60, 18 * 60, 24)).toBe(true)
    expect(prematureEof(23.5 * 60, 23.5 * 60, 24)).toBe(false)
  })
})
