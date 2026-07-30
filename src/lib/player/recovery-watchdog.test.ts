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
    expect(recoveryWatchDecision(state, signal(2_000 + STALL_TIMEOUT_MS, {
      firstFrame: true,
      position: 10,
    })).reason).toBe('stalled')
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
})
