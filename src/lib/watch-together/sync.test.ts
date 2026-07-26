import { describe, expect, it } from 'vitest'
import {
  BUFFER_HOLD_MAX_MS,
  bestOffsetMs,
  bufferGateDecision,
  clockSample,
  driftDecision,
  hostPositionNow,
  MAX_CLOCK_SAMPLES,
  pushSample,
  SEEK_SETTLE_MS,
  type ClockSample,
  type DriftInput,
} from './sync'

describe('clock handshake', () => {
  it('recovers a pure clock offset with no network delay', () => {
    // Host runs 4s ahead. Instant exchange: t1/t2 are the host's stamps for the same instant.
    const s = clockSample(1_000, 5_000, 5_000, 1_000)
    expect(s?.offsetMs).toBe(4_000)
    expect(s?.rttMs).toBe(0)
  })

  it('cancels the host store-and-forward delay instead of folding it into the offset', () => {
    // Clocks are identical. 100ms each way, and the host sits on the ping for a full 1s heartbeat
    // before publishing the pong. A three-timestamp form would report ~550ms of offset here.
    const s = clockSample(0, 100, 1_100, 1_200)
    expect(s?.offsetMs).toBe(0)
    expect(s?.rttMs).toBe(200)
  })

  it('rejects implausible samples rather than poisoning the estimate', () => {
    expect(clockSample(0, 100, 200, 10_000)).toBeNull() // rtt way over the ceiling
    // Host claims it held the ping longer than the whole round trip took — its stamps are not
    // self-consistent (a clock jump mid-exchange), so the sample tells us nothing.
    expect(clockSample(0, 0, 1_000, 100)).toBeNull()
    expect(clockSample(0, 1, 2, Number.NaN)).toBeNull()
  })

  it('prefers the lowest-RTT sample over the newest or the average', () => {
    const samples: ClockSample[] = [
      { offsetMs: 400, rttMs: 900, at: 1_000 },
      { offsetMs: 250, rttMs: 40, at: 2_000 },
      { offsetMs: 600, rttMs: 1_500, at: 3_000 },
    ]
    expect(bestOffsetMs(samples, 3_100)).toBe(250)
  })

  it('degrades to zero offset with no samples, matching a host too old to answer pings', () => {
    expect(bestOffsetMs([], 1_000)).toBe(0)
  })

  it('expires stale samples and bounds the window', () => {
    const old: ClockSample = { offsetMs: 999, rttMs: 1, at: 0 }
    expect(bestOffsetMs([old], 200_000)).toBe(0)

    let samples: ClockSample[] = []
    for (let i = 0; i < MAX_CLOCK_SAMPLES + 5; i++) {
      samples = pushSample(samples, { offsetMs: i, rttMs: 10, at: i }, i)
    }
    expect(samples).toHaveLength(MAX_CLOCK_SAMPLES)
  })

  it('drops expired samples even when the new one is unusable', () => {
    const old: ClockSample = { offsetMs: 5, rttMs: 1, at: 0 }
    expect(pushSample([old], null, 200_000)).toHaveLength(0)
  })
})

describe('host position extrapolation', () => {
  const playback = { position: 100, duration: 1_400, paused: false, sentAt: 10_000 }

  it('uses the measured offset, not the raw local clock', () => {
    // Guest clock is 4s BEHIND the host. Naively `now - sentAt` would read -4s of elapsed time and
    // (clamped at 0) pin the guest 4s behind the host forever.
    expect(hostPositionNow(playback, 4_000, 6_000)).toBe(100)
    expect(hostPositionNow(playback, 4_000, 7_000)).toBe(101)
  })

  it('does not extrapolate a paused host', () => {
    expect(hostPositionNow({ ...playback, paused: true }, 0, 99_000)).toBe(100)
  })

  it('clamps to the file duration', () => {
    expect(hostPositionNow(playback, 0, 10_000 + 9_999_000)).toBe(1_400)
  })
})

describe('drift ladder', () => {
  const base: DriftInput = {
    localPosition: 100, localPaused: false, hostPosition: 100, hostPaused: false,
    now: 100_000, lastSeekAt: 0, streak: 0,
  }

  it('leaves small drift alone', () => {
    expect(driftDecision({ ...base, hostPosition: 100.7 }).seekTo).toBeNull()
  })

  it('requires two consecutive samples before a moderate correction', () => {
    const first = driftDecision({ ...base, hostPosition: 102 })
    expect(first.seekTo).toBeNull()
    expect(first.streak).toBe(1)
    const second = driftDecision({ ...base, hostPosition: 102, streak: first.streak })
    expect(second.seekTo).toBe(102)
    expect(second.streak).toBe(0)
  })

  it('clears the streak as soon as drift falls back in range', () => {
    expect(driftDecision({ ...base, hostPosition: 100.2, streak: 1 }).streak).toBe(0)
  })

  it('corrects a hard desync on the first sample', () => {
    expect(driftDecision({ ...base, hostPosition: 140 }).seekTo).toBe(140)
  })

  it('holds a tighter line while paused', () => {
    expect(driftDecision({ ...base, localPaused: true, hostPaused: true, hostPosition: 101 }).seekTo).toBe(101)
    expect(driftDecision({ ...base, localPaused: true, hostPaused: true, hostPosition: 100.5 }).seekTo).toBeNull()
  })

  it('ignores drift inside the settle window after its own seek', () => {
    const d = driftDecision({ ...base, hostPosition: 140, lastSeekAt: 100_000 - (SEEK_SETTLE_MS - 1) })
    expect(d.seekTo).toBeNull()
    expect(d.streak).toBe(0)
  })

  it('acts again once the settle window has passed', () => {
    expect(driftDecision({ ...base, hostPosition: 140, lastSeekAt: 100_000 - (SEEK_SETTLE_MS + 1) }).seekTo).toBe(140)
  })

  it('reports a pause mismatch independently of the position correction', () => {
    expect(driftDecision({ ...base, hostPaused: true, localPaused: false }).setPaused).toBe(true)
    expect(driftDecision(base).setPaused).toBeNull()
  })

  it('still applies pause while suppressing a seek inside the settle window', () => {
    const d = driftDecision({ ...base, hostPaused: true, hostPosition: 140, lastSeekAt: 99_900 })
    expect(d.seekTo).toBeNull()
    expect(d.setPaused).toBe(true)
  })
})

describe('buffer gate', () => {
  const idle = { holdingSince: null }

  it('pauses the room when a peer starts buffering', () => {
    const d = bufferGateDecision(idle, { anyBuffering: true, hostPaused: false, now: 5_000 })
    expect(d.setPaused).toBe(true)
    expect(d.state.holdingSince).toBe(5_000)
    expect(d.notice).not.toBe('')
  })

  it('does nothing when nobody is buffering', () => {
    expect(bufferGateDecision(idle, { anyBuffering: false, hostPaused: false, now: 1 }).setPaused).toBeNull()
  })

  it('does not hijack a host who is already paused', () => {
    const d = bufferGateDecision(idle, { anyBuffering: true, hostPaused: true, now: 1 })
    expect(d.setPaused).toBeNull()
    expect(d.state.holdingSince).toBeNull()
  })

  it('resumes once every peer is ready', () => {
    const d = bufferGateDecision({ holdingSince: 5_000 }, { anyBuffering: false, hostPaused: true, now: 8_000 })
    expect(d.setPaused).toBe(false)
    expect(d.state.holdingSince).toBeNull()
  })

  it('holds while the peer is still buffering', () => {
    const d = bufferGateDecision({ holdingSince: 5_000 }, { anyBuffering: true, hostPaused: true, now: 8_000 })
    expect(d.setPaused).toBeNull()
    expect(d.state.holdingSince).toBe(5_000)
  })

  it('gives up on a peer that never recovers', () => {
    const d = bufferGateDecision(
      { holdingSince: 5_000 },
      { anyBuffering: true, hostPaused: true, now: 5_000 + BUFFER_HOLD_MAX_MS },
    )
    expect(d.setPaused).toBe(false)
    expect(d.state.holdingSince).toBeNull()
    expect(d.notice).toContain('Carried on')
  })

  it('stands down instead of re-pausing a host who hit play during a hold', () => {
    const d = bufferGateDecision({ holdingSince: 5_000 }, { anyBuffering: true, hostPaused: false, now: 6_000 })
    expect(d.setPaused).toBeNull()
    expect(d.state.holdingSince).toBeNull()
  })
})
