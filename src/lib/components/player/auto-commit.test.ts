import { describe, expect, it } from 'vitest'
import { AUTO_CURATED_GRACE_MS, autoCommitPhase, autoCommitProgress } from './auto-commit'

const AUTO_MS = 2500
const phase = (elapsed: number, curatedPending: boolean) =>
  autoCommitPhase({ elapsed, autoMs: AUTO_MS, curatedPending })

describe('autoCommitPhase', () => {
  it('counts down for the full countdown regardless of the curated lookup', () => {
    expect(phase(0, true)).toBe('counting')
    expect(phase(0, false)).toBe('counting')
    expect(phase(AUTO_MS - 1, true)).toBe('counting')
  })

  it('commits the moment the countdown ends when nothing is in flight', () => {
    expect(phase(AUTO_MS, false)).toBe('commit')
    expect(phase(AUTO_MS + 5000, false)).toBe('commit')
  })

  it('holds at full while the curated best-release lookup is still out', () => {
    // The bug this exists for: "Mark best releases" is on, the entry lands a moment after the
    // countdown committed, and the auto-pick ignored the curation entirely.
    expect(phase(AUTO_MS, true)).toBe('holding')
    expect(phase(AUTO_MS + AUTO_CURATED_GRACE_MS - 1, true)).toBe('holding')
  })

  it('commits as soon as the lookup settles, without waiting out the grace', () => {
    expect(phase(AUTO_MS + 200, true)).toBe('holding')
    expect(phase(AUTO_MS + 200, false)).toBe('commit')
  })

  it('caps the hold so a hanging releases.moe cannot stall playback', () => {
    expect(phase(AUTO_MS + AUTO_CURATED_GRACE_MS, true)).toBe('commit')
    expect(phase(AUTO_MS + 60_000, true)).toBe('commit')
  })

  it('honours a caller-supplied grace', () => {
    expect(autoCommitPhase({ elapsed: 3000, autoMs: AUTO_MS, curatedPending: true, graceMs: 100 })).toBe('commit')
    expect(autoCommitPhase({ elapsed: 2550, autoMs: AUTO_MS, curatedPending: true, graceMs: 100 })).toBe('holding')
  })
})

describe('autoCommitProgress', () => {
  it('fills over the countdown and stays full through a hold', () => {
    expect(autoCommitProgress(0, AUTO_MS)).toBe(0)
    expect(autoCommitProgress(AUTO_MS / 2, AUTO_MS)).toBe(0.5)
    expect(autoCommitProgress(AUTO_MS, AUTO_MS)).toBe(1)
    // A hold must not push the bar (or the "Auto Ns" readout) past its end.
    expect(autoCommitProgress(AUTO_MS + AUTO_CURATED_GRACE_MS, AUTO_MS)).toBe(1)
  })
})
