import { describe, expect, it } from 'vitest'
import {
  START_TIMEOUT_MS,
  STALL_TIMEOUT_MS,
  recoveryWatchDecision,
  resetRecoveryWatch,
} from './recovery-watchdog'

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
