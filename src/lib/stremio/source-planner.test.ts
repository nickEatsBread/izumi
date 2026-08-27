import { describe, expect, it } from 'vitest'
import type { PlaybackTransport, SourceOutcomeSummary } from '$lib/player/source-outcomes'
import { planSources, plannedTransport } from './source-planner'
import type { Stream } from './parse'

const NOW = Date.UTC(2026, 7, 27)

const stream = (id: string, quality = 1080, extra: Partial<Stream> = {}): Stream => ({
  url: `https://${id}.example/video.mkv`,
  title: `Show - 01 ${quality}p`,
  __origin: { kind: 'online-extension', id, name: id },
  ...extra,
})

function outcome(stable: number, failures: number, extra: Partial<SourceOutcomeSummary> = {}): SourceOutcomeSummary {
  const attempts = stable + failures
  return {
    context: { family: 'online-extension', sourceId: 'test', transport: 'http' },
    attempts,
    resolved: stable,
    firstFrames: stable,
    stable,
    completed: 0,
    failures,
    cancellations: 0,
    failureClasses: {},
    lastAt: NOW,
    ...extra,
  }
}

const lookup = (summaries: Map<Stream, SourceOutcomeSummary>) =>
  (candidate: Stream, _transport: PlaybackTransport) => summaries.get(candidate)

describe('adaptive source planner', () => {
  it('requires repeated local observations before changing the baseline', () => {
    const usual = stream('usual')
    const alternative = stream('alternative')
    const summaries = new Map<Stream, SourceOutcomeSummary>([
      [usual, outcome(0, 2)],
      [alternative, outcome(2, 0)],
    ])
    const plan = planSources([usual, alternative], { directP2p: false, outcomeOf: lookup(summaries), now: NOW })
    expect(plan.planned).toEqual([usual, alternative])
    expect(plan.changed).toBe(false)
  })

  it('previews a proven route and explains the evidence', () => {
    const usual = stream('usual')
    const proven = stream('proven')
    const summaries = new Map<Stream, SourceOutcomeSummary>([
      [usual, outcome(0, 4)],
      [proven, outcome(4, 0, { firstFrames: 4, firstFrameMs: 2_100 })],
    ])
    const plan = planSources([usual, proven], { directP2p: false, outcomeOf: lookup(summaries), now: NOW })
    expect(plan.planned).toEqual([proven, usual])
    expect(plan.changed).toBe(true)
    expect(plan.headChanged).toBe(true)
    expect(plan.explanation).toContain('4/4 locally observed starts became stable')
    expect(plan.explanation).toContain('2.1s')
    expect(plan.explanation).toContain('usual first source 4/4 locally observed starts failed')
    expect(plan.candidates[0].confidence).toBe('medium')
  })

  it('never crosses cache, resolution, language, or explicit source-priority walls', () => {
    const usual = stream('usual')
    const lowerQuality = stream('lower', 720)
    const wrongLanguage = stream('foreign', 1080, { __langMismatch: true })
    const uncached = stream('uncached', 1080, {
      url: undefined,
      infoHash: 'a'.repeat(40),
      __cache: 'uncached',
      __seeders: 10,
    })
    const preferred = stream('preferred')
    const all = [usual, lowerQuality, wrongLanguage, uncached, preferred]
    const summaries = new Map(all.map((candidate) => [candidate, outcome(candidate === usual ? 0 : 12, candidate === usual ? 12 : 0)]))
    const plan = planSources(all, {
      directP2p: true,
      audioLang: 'jpn',
      sourcePriority: ['usual', 'preferred'],
      outcomeOf: lookup(summaries),
      now: NOW,
    })
    expect(plan.planned).toEqual(all)
  })

  it('uses structured provider claims as weak, explainable evidence', () => {
    const usual = stream('usual')
    const claimed = stream('claimed', 1080, {
      __evidence: { confirmedMatch: true, bestRelease: true, upstreamRank: 0 },
    })
    const plan = planSources([usual, claimed], { directP2p: false, now: NOW })
    expect(plan.planned[0]).toBe(claimed)
    expect(plan.explanation).toContain('provider marked it as a best release')
    expect(plan.candidates[0].confidence).toBe('low')
  })

  it('caps movement to two positions within an equivalent bucket', () => {
    const sources = Array.from({ length: 6 }, (_, index) => stream(`source-${index}`))
    const summaries = new Map<Stream, SourceOutcomeSummary>(sources.map((candidate, index) => [
      candidate,
      outcome(index === 5 ? 20 : 0, index === 5 ? 0 : 20),
    ]))
    const plan = planSources(sources, { directP2p: false, outcomeOf: lookup(summaries), now: NOW })
    expect(plan.planned.indexOf(sources[5])).toBe(3)
  })

  it('distinguishes a lower fallback reorder from a changed first choice', () => {
    const first = stream('first', 2160)
    const weak = stream('weak')
    const proven = stream('proven')
    const summaries = new Map<Stream, SourceOutcomeSummary>([
      [weak, outcome(0, 4)],
      [proven, outcome(4, 0)],
    ])
    const plan = planSources([first, weak, proven], { directP2p: false, outcomeOf: lookup(summaries), now: NOW })
    expect(plan.planned).toEqual([first, proven, weak])
    expect(plan.changed).toBe(true)
    expect(plan.headChanged).toBe(false)
    expect(plan.explanation).toBe('')
  })

  it('decays stale local history instead of making a permanent blacklist', () => {
    const usual = stream('usual')
    const oldWinner = stream('old-winner')
    const stale = NOW - 365 * 24 * 60 * 60 * 1_000
    const summaries = new Map<Stream, SourceOutcomeSummary>([
      [usual, outcome(0, 20, { lastAt: stale })],
      [oldWinner, outcome(20, 0, { lastAt: stale })],
    ])
    const plan = planSources([usual, oldWinner], { directP2p: false, outcomeOf: lookup(summaries), now: NOW })
    expect(plan.changed).toBe(false)
  })

  it('derives the same transport families used by playback observations', () => {
    expect(plannedTransport({ infoHash: 'b'.repeat(40) }, true)).toBe('direct-p2p')
    expect(plannedTransport({ infoHash: 'b'.repeat(40) }, false)).toBe('debrid')
    expect(plannedTransport({ url: 'https://cdn.example/master.m3u8' }, false)).toBe('hls')
    expect(plannedTransport({ url: 'https://cdn.example/manifest.mpd' }, false)).toBe('dash')
    expect(plannedTransport({ url: 'https://cdn.example/video.mp4', __drm: {} as never }, false)).toBe('drm')
  })
})
