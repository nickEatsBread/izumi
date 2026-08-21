import { describe, expect, it } from 'vitest'
import {
  PRESENCE_POSITION_INTERVAL_MS,
  presenceDecision,
  presenceSignature,
  type PresencePayload,
} from './presence'
import { presenceAllowed } from './gm-overlay'

const payload = (over: Partial<PresencePayload> = {}): PresencePayload => ({
  title: 'The Beach Episode',
  series: 'A Series',
  episode: 7,
  duration: 1440,
  position: 120,
  paused: false,
  coverUrl: 'https://example.invalid/cover.jpg',
  systemControls: true,
  discord: false,
  private: false,
  seekSeconds: 10,
  ...over,
})

describe('presenceSignature', () => {
  it('ignores the playhead', () => {
    expect(presenceSignature(payload({ position: 0 }))).toBe(presenceSignature(payload({ position: 900 })))
  })

  it('changes for pause, episode, settings, and the privacy flag', () => {
    const base = presenceSignature(payload())
    expect(presenceSignature(payload({ paused: true }))).not.toBe(base)
    expect(presenceSignature(payload({ episode: 8 }))).not.toBe(base)
    expect(presenceSignature(payload({ systemControls: false }))).not.toBe(base)
    expect(presenceSignature(payload({ discord: true }))).not.toBe(base)
    expect(presenceSignature(payload({ private: true }))).not.toBe(base)
    expect(presenceSignature(payload({ seekSeconds: 30 }))).not.toBe(base)
  })
})

describe('presenceDecision', () => {
  it('sends the very first update immediately', () => {
    const decision = presenceDecision(null, payload(), 1_000)
    expect(decision.send).toBe(true)
    expect(decision.state.sentAt).toBe(1_000)
  })

  it('keeps the playhead moving at ~1 Hz', () => {
    // The bug: the position was only read once per episode, so MPRIS/SMTC froze at 0. It must
    // still advance — but not once per 250ms progress tick.
    let state = presenceDecision(null, payload({ position: 0 }), 0).state
    const quick = presenceDecision(state, payload({ position: 0.25 }), 250)
    expect(quick.send).toBe(false)
    expect(quick.waitMs).toBe(PRESENCE_POSITION_INTERVAL_MS - 250)
    expect(quick.state).toBe(state)

    const due = presenceDecision(state, payload({ position: 1 }), 1_000)
    expect(due.send).toBe(true)
    state = due.state
    expect(presenceDecision(state, payload({ position: 1.25 }), 1_250).send).toBe(false)
  })

  it('never throttles a pause so Discord reflects the paused state immediately', () => {
    const state = presenceDecision(null, payload({ position: 0 }), 0).state
    const paused = presenceDecision(state, payload({ position: 0.25, paused: true }), 250)
    expect(paused.send).toBe(true)
    expect(paused.waitMs).toBe(0)
  })

  it('never throttles a settings toggle flipped mid-episode', () => {
    const state = presenceDecision(null, payload(), 0).state
    expect(presenceDecision(state, payload({ systemControls: false }), 50).send).toBe(true)
    expect(presenceDecision(state, payload({ discord: true }), 50).send).toBe(true)
  })

  it('never throttles a track change', () => {
    const state = presenceDecision(null, payload(), 0).state
    expect(presenceDecision(state, payload({ episode: 8, title: 'Next One', position: 0 }), 10).send).toBe(true)
  })

  it('recovers from a clock that jumped backwards', () => {
    const state = presenceDecision(null, payload({ position: 5 }), 10_000).state
    expect(presenceDecision(state, payload({ position: 6 }), 4_000).send).toBe(true)
  })
})

describe('presenceAllowed', () => {
  it('is off in Game mode so Discord/SMTC do not run on the Deck', () => {
    expect(presenceAllowed(true)).toBe(false)
    expect(presenceAllowed(false)).toBe(true)
  })
})
