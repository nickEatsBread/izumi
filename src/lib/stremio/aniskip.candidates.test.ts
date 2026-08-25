import { describe, expect, it } from 'vitest'
import {
  resolveCandidates,
  segmentsFromResponses,
  skipTimeUrls,
  SKIP_RETRY_MS,
  type AniSkipResp,
  type SkipCandidate,
} from './aniskip'

const cand = (start: number, end: number, type: 'op' | 'ed' | 'recap', mixed = false): SkipCandidate =>
  ({ start, end, type, label: type, mixed })

describe('skip-time retries', () => {
  it('retries after broadcast so a new episode can pick up crowd timings', () => {
    expect(SKIP_RETRY_MS[0]).toBe(0)
    expect(SKIP_RETRY_MS[1]).toBeGreaterThan(5_000)
    expect(SKIP_RETRY_MS[2]).toBeGreaterThan(SKIP_RETRY_MS[1])
  })
})

describe('runtime-aware skip lookup', () => {
  it('requests both the playing runtime and an unfiltered fallback', () => {
    const urls = skipTimeUrls(123, 4, 1440.1234)
    expect(urls).toHaveLength(2)
    expect(urls[0]).toContain('/123/4/?episodeLength=1440.123')
    expect(urls[1]).toContain('/123/4/?episodeLength=0')
    for (const type of ['op', 'ed', 'recap', 'mixed-op', 'mixed-ed']) {
      expect(urls[0]).toContain(`&types=${type}`)
    }
  })

  it('does not duplicate the fallback request when duration is unknown', () => {
    expect(skipTimeUrls(123, 4, 0)).toHaveLength(1)
    expect(skipTimeUrls(123, 4, Number.POSITIVE_INFINITY)).toHaveLength(1)
  })

  it('prefers runtime-matched annotations and fills missing types from fallback data', () => {
    const exact: AniSkipResp = {
      found: true,
      results: [{
        skipType: 'op',
        interval: { startTime: 60, endTime: 150 },
        episodeLength: 1440,
      }],
    }
    const fallback: AniSkipResp = {
      found: true,
      results: [
        {
          skipType: 'op',
          interval: { startTime: 10, endTime: 100 },
          episodeLength: 1400,
        },
        {
          skipType: 'ed',
          interval: { startTime: 1300, endTime: 1390 },
          episodeLength: 1400,
        },
      ],
    }

    expect(segmentsFromResponses([exact, fallback], 1440)).toEqual([
      { start: 60, end: 150, type: 'op', label: 'Opening' },
      { start: 1340, end: 1430, type: 'ed', label: 'Ending' },
    ])
  })

  it('clamps shifted fallback intervals to the playing file', () => {
    const fallback: AniSkipResp = {
      found: true,
      results: [{
        skipType: 'ed',
        interval: { startTime: 1380, endTime: 1500 },
        episodeLength: 1450,
      }],
    }
    expect(segmentsFromResponses([fallback], 1440)).toEqual([
      { start: 1370, end: 1440, type: 'ed', label: 'Ending' },
    ])
  })
})

describe('resolveCandidates', () => {
  it('unions a mixed annotation of the same theme', () => {
    expect(resolveCandidates([cand(47.37, 137.37, 'op'), cand(75, 135, 'op', true)]))
      .toEqual([{ start: 47.37, end: 137.37, type: 'op', label: 'op' }])
  })

  it('extends the union when the mixed annotation runs longer', () => {
    const [seg] = resolveCandidates([cand(47, 100, 'op'), cand(75, 137, 'op', true)])
    expect(seg).toMatchObject({ start: 47, end: 137 })
  })

  it('drops a mixed annotation contradicted by a plain one of another type', () => {
    // Verified live 2026-07-26 against MAL 16498 episode 1. Without this the bogus mixed-ed sorts
    // first, the button reads "Skip Ending" during the opening, and auto-skip lands at 114.41 —
    // inside the OP.
    const resolved = resolveCandidates([
      cand(47.37, 137.37, 'op'),
      cand(1342.8, 1430.62, 'ed'),
      cand(75, 135, 'op', true),
      cand(24.41, 114.41, 'ed', true),
    ])
    expect(resolved).toEqual([
      { start: 47.37, end: 137.37, type: 'op', label: 'op' },
      { start: 1342.8, end: 1430.62, type: 'ed', label: 'ed' },
    ])
  })

  it('keeps a mixed annotation that contradicts nothing', () => {
    // Jujutsu Kaisen ep1: a genuine mid-episode ED, no competing plain annotation there.
    expect(resolveCandidates([cand(223.965, 313.965, 'ed', true)]))
      .toEqual([{ start: 223.965, end: 313.965, type: 'ed', label: 'ed' }])
  })

  it('does not let one plain annotation veto an unrelated mixed one elsewhere in the episode', () => {
    const resolved = resolveCandidates([cand(47, 137, 'op'), cand(600, 660, 'ed', true)])
    expect(resolved).toHaveLength(2)
  })

  it('lets a plain annotation inside a union vouch for the whole range', () => {
    // op ∪ mixed-op is no longer "mixed", so a later overlapping plain ED cannot veto it.
    const resolved = resolveCandidates([
      cand(47, 100, 'op'), cand(90, 140, 'op', true), cand(120, 200, 'ed'),
    ])
    expect(resolved.map((s) => s.type)).toEqual(['op', 'ed'])
  })

  it('returns segments in playback order', () => {
    const resolved = resolveCandidates([cand(1342, 1430, 'ed'), cand(0, 30, 'recap'), cand(47, 137, 'op')])
    expect(resolved.map((s) => s.start)).toEqual([0, 47, 1342])
  })
})
