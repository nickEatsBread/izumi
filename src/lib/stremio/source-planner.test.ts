import { describe, expect, it } from 'vitest'
import {
  OUTCOME_HALF_LIFE_MS,
  SourceOutcomeJournal,
  type PlaybackTransport,
  type SourceOutcomeContext,
  type SourceOutcomeCounts,
  type SourceOutcomeSummary,
} from '$lib/player/source-outcomes'
import { planRecoveryCandidates, planSources, plannedTransport } from './source-planner'
import { normalizeCandidates } from './candidate-model'
import type { Stream } from './parse'

const NOW = Date.UTC(2026, 7, 27)

const stream = (id: string, quality = 1080, extra: Partial<Stream> = {}): Stream => ({
  url: `https://${id}.example/video.mkv`,
  title: `Show - 01 ${quality}p`,
  __origin: { kind: 'online-extension', id, name: id },
  ...extra,
})

const emptyCounts = (): SourceOutcomeCounts => ({
  attempts: 0,
  startupSuccesses: 0,
  startupFailures: 0,
  stableSuccesses: 0,
  playbackFailures: 0,
  cancellations: 0,
  failureClasses: {},
  resolveSamples: 0,
  firstFrameSamples: 0,
})

function outcome(stable: number, failures: number, extra: { firstFrameMs?: number; manual?: boolean } = {}): SourceOutcomeSummary {
  const attempts = stable + failures
  const counts: SourceOutcomeCounts = {
    ...emptyCounts(),
    attempts,
    startupSuccesses: stable,
    startupFailures: failures,
    stableSuccesses: stable,
    firstFrameSamples: extra.firstFrameMs == null ? 0 : stable,
    firstFrameMs: extra.firstFrameMs,
    failureClasses: failures ? { stalled: failures } : {},
  }
  return {
    context: { family: 'online-extension', sourceId: 'test', transport: 'http' },
    automatic: extra.manual ? emptyCounts() : counts,
    manual: extra.manual ? counts : emptyCounts(),
    evidenceAt: NOW,
    lastAt: NOW,
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

  it('treats the active observation minimum as a floor, not proof by itself', () => {
    const usual = stream('usual')
    const perfectButSparse = stream('perfect-but-sparse')
    const summaries = new Map<Stream, SourceOutcomeSummary>([
      [perfectButSparse, outcome(8, 0)],
    ])
    expect(planSources([usual, perfectButSparse], {
      directP2p: false,
      outcomeOf: lookup(summaries),
    }).planned).toEqual([usual, perfectButSparse])
  })

  it('promotes a proven route only after conservative confidence clears the baseline', () => {
    const usual = stream('usual')
    const proven = stream('proven')
    const summaries = new Map<Stream, SourceOutcomeSummary>([
      [usual, outcome(0, 12)],
      [proven, outcome(12, 0, { firstFrameMs: 2_100 })],
    ])
    const plan = planSources([usual, proven], { directP2p: false, outcomeOf: lookup(summaries), now: NOW })
    expect(plan.planned).toEqual([proven, usual])
    expect(plan.changed).toBe(true)
    expect(plan.headChanged).toBe(true)
    expect(plan.explanation).toContain('recent weighted starts')
    expect(plan.explanation).toContain('2.1s')
    expect(plan.explanation).toContain('usual first source')
    expect(plan.candidates[0].confidence).toBe('medium')
  })

  it('never crosses cache, resolution, language, subtitle, or explicit source-priority walls', () => {
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
    const wrongSubtitles = stream('french-only', 1080, { title: 'Show S01E01 SUBFRENCH 1080p' })
    const all = [usual, lowerQuality, wrongLanguage, uncached, preferred, wrongSubtitles]
    const summaries = new Map(all.map((candidate) => [candidate, outcome(candidate === usual ? 0 : 12, candidate === usual ? 12 : 0)]))
    const plan = planSources(all, {
      directP2p: true,
      audioLang: 'jpn',
      subtitleLang: 'eng',
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
    const plan = planSources([usual, claimed], { directP2p: false, policy: 'preview', now: NOW })
    expect(plan.planned[0]).toBe(claimed)
    expect(plan.explanation).toContain('provider marked it as a best release')
    expect(plan.candidates[0].confidence).toBe('low')
  })

  it('never activates a provider self-claim without local evidence', () => {
    const usual = stream('usual')
    const claimed = stream('claimed', 1080, { __evidence: { confirmedMatch: true, bestRelease: true } })
    expect(planSources([usual, claimed], { directP2p: false, policy: 'active' }).planned).toEqual([usual, claimed])
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
      [weak, outcome(0, 12)],
      [proven, outcome(12, 0)],
    ])
    const plan = planSources([first, weak, proven], { directP2p: false, outcomeOf: lookup(summaries), now: NOW })
    expect(plan.planned).toEqual([first, proven, weak])
    expect(plan.changed).toBe(true)
    expect(plan.headChanged).toBe(false)
    expect(plan.explanation).toBe('')
  })

  it('ignores already-decayed evidence below the effective observation floor', () => {
    const usual = stream('usual')
    const oldWinner = stream('old-winner')
    const summaries = new Map<Stream, SourceOutcomeSummary>([
      [usual, outcome(0, 0.05)],
      [oldWinner, outcome(0.05, 0)],
    ])
    const plan = planSources([usual, oldWinner], { directP2p: false, outcomeOf: lookup(summaries), now: NOW })
    expect(plan.changed).toBe(false)
  })

  it('downweights manually selected evidence so it cannot quickly steer autoplay', () => {
    const usual = stream('usual')
    const manuallyTried = stream('manual')
    const summaries = new Map<Stream, SourceOutcomeSummary>([
      [usual, outcome(0, 8)],
      [manuallyTried, outcome(12, 0, { manual: true })],
    ])
    expect(planSources([usual, manuallyTried], {
      directP2p: false,
      outcomeOf: lookup(summaries),
    }).planned).toEqual([usual, manuallyTried])
  })

  it('does not let startup speed override clearly worse reliability', () => {
    const reliable = stream('reliable')
    const fastButFlaky = stream('fast-but-flaky')
    const summaries = new Map<Stream, SourceOutcomeSummary>([
      [reliable, outcome(18, 2, { firstFrameMs: 12_000 })],
      [fastButFlaky, outcome(12, 8, { firstFrameMs: 900 })],
    ])
    expect(planSources([reliable, fastButFlaky], {
      directP2p: false,
      outcomeOf: lookup(summaries),
    }).planned).toEqual([reliable, fastButFlaky])
  })

  it('never lets conditional stability rescue poor startup reliability', () => {
    const usual = stream('usual')
    const rarelyStarts = stream('rarely-starts')
    const summaries = new Map<Stream, SourceOutcomeSummary>([
      [rarelyStarts, outcome(4, 16)],
    ])
    const plan = planSources([usual, rarelyStarts], {
      directP2p: false,
      outcomeOf: lookup(summaries),
    })
    expect(plan.planned).toEqual([usual, rarelyStarts])
    expect(plan.candidates.find((candidate) => candidate.stream === rarelyStarts)?.adaptiveScore).toBeLessThan(0.28)
  })

  it('preserves the candidate set and two-place bound across generated evidence histories', () => {
    let random = 0x5eed1234
    const next = () => {
      random ^= random << 13
      random ^= random >>> 17
      random ^= random << 5
      return random >>> 0
    }
    for (let scenario = 0; scenario < 200; scenario++) {
      const count = 2 + next() % 11
      const sources = Array.from({ length: count }, (_, index) => stream(`generated-${scenario}-${index}`))
      const summaries = new Map<Stream, SourceOutcomeSummary>(sources.map((candidate) => {
        const trials = next() % 31
        const successes = trials ? next() % (trials + 1) : 0
        return [candidate, outcome(successes, trials - successes)]
      }))
      const plan = planSources(sources, { directP2p: false, outcomeOf: lookup(summaries) })
      expect(plan.planned).toHaveLength(sources.length)
      expect(new Set(plan.planned).size).toBe(sources.length)
      expect(plan.planned.every((candidate) => sources.includes(candidate))).toBe(true)
      for (const candidate of sources) {
        expect(Math.abs(plan.planned.indexOf(candidate) - sources.indexOf(candidate))).toBeLessThanOrEqual(2)
      }
      for (const candidate of plan.candidates) {
        expect(candidate.baselineIndex).toBe(sources.indexOf(candidate.stream))
      }
    }
  })

  it('adapts after a provider regime shift instead of preserving an old winner forever', () => {
    let now = 0
    const contextOf = (id: string): SourceOutcomeContext => ({
      family: 'online-extension', sourceId: id, transport: 'http',
    })
    const journals = new Map([
      ['old-winner', new SourceOutcomeJournal(undefined, () => true, () => now)],
      ['steady', new SourceOutcomeJournal(undefined, () => true, () => now)],
    ])
    const observe = (id: string, successes: number, failures: number) => {
      const journal = journals.get(id)!
      for (let index = 0; index < successes; index++) journal.mark(journal.begin(contextOf(id), true), 'stable')
      for (let index = 0; index < failures; index++) journal.fail(journal.begin(contextOf(id), true), 'stalled')
    }
    const oldWinner = stream('old-winner')
    const steady = stream('steady')
    const outcomeOf = (candidate: Stream) => journals.get(candidate.__origin!.id)?.summary(contextOf(candidate.__origin!.id))

    observe('old-winner', 38, 2)
    observe('steady', 26, 14)
    expect(planSources([steady, oldWinner], { directP2p: false, outcomeOf }).planned[0]).toBe(oldWinner)

    now = 4 * OUTCOME_HALF_LIFE_MS
    observe('old-winner', 2, 18)
    observe('steady', 16, 4)
    expect(planSources([oldWinner, steady], { directP2p: false, outcomeOf }).planned[0]).toBe(steady)
  })

  it('derives the same transport families used by playback observations', () => {
    expect(plannedTransport({ infoHash: 'b'.repeat(40) }, true)).toBe('direct-p2p')
    expect(plannedTransport({ infoHash: 'b'.repeat(40) }, false)).toBe('debrid')
    expect(plannedTransport({ url: 'https://cdn.example/master.m3u8' }, false)).toBe('hls')
    expect(plannedTransport({ url: 'https://cdn.example/manifest.mpd' }, false)).toBe('dash')
    expect(plannedTransport({ url: 'https://cdn.example/video.mp4', __drm: {} as never }, false)).toBe('drm')
  })
})

describe('diagnosis-aware recovery plan', () => {
  const torrent = (origin: string, hash: string): Stream => ({
    infoHash: hash.repeat(40),
    title: 'Show - 01 1080p',
    __origin: { kind: 'torrent-extension', id: origin, name: origin },
  })

  it('never retries the same release after wrong-content evidence', () => {
    const [failed, sameBytes, different] = normalizeCandidates([
      torrent('nyaa', 'a'),
      torrent('animetosho', 'a'),
      torrent('nyaa', 'b'),
    ])
    expect(planRecoveryCandidates([sameBytes, different], failed, 'wrong-content', { directP2p: true })).toEqual([different])
  })

  it('tries one alternate route, then diversifies releases after a transport failure', () => {
    const [failed, sameOne, sameTwo, releaseBOne, releaseBTwo, releaseC] = normalizeCandidates([
      torrent('one', 'a'),
      torrent('two', 'a'),
      torrent('three', 'a'),
      torrent('one', 'b'),
      torrent('two', 'b'),
      torrent('one', 'c'),
    ])
    const planned = planRecoveryCandidates(
      [sameOne, sameTwo, releaseBOne, releaseBTwo, releaseC],
      failed,
      'stalled',
      { directP2p: true },
    )
    expect(planned.slice(0, 3)).toEqual([sameOne, releaseBOne, releaseC])
    expect(planned).toEqual([sameOne, releaseBOne, releaseC, releaseBTwo, sameTwo])
  })

  it('demotes the failed provider for provider-wide faults', () => {
    const failed = stream('provider-a')
    const sameProvider = stream('provider-a', 1080, { url: 'https://backup.example/video.mkv' })
    const independent = stream('provider-b')
    expect(planRecoveryCandidates([sameProvider, independent], failed, 'auth', { directP2p: false })).toEqual([independent, sameProvider])
  })

  it('does not blame the source addon or retry the same release for a debrid resolver failure', () => {
    const failed = {
      ...torrent('addon-a', 'a'),
      __candidate: { releaseId: 'release-a', offerId: 'failed', routeId: 'failed', offerCount: 2, routeCount: 2 },
    }
    const sameReleaseOtherAddon = {
      ...torrent('addon-b', 'a'),
      __candidate: { releaseId: 'release-a', offerId: 'same', routeId: 'same', offerCount: 2, routeCount: 2 },
    }
    const otherReleaseSameAddon = {
      ...torrent('addon-a', 'b'),
      __candidate: { releaseId: 'release-b', offerId: 'other', routeId: 'other', offerCount: 1, routeCount: 1 },
    }
    expect(planRecoveryCandidates(
      [sameReleaseOtherAddon, otherReleaseSameAddon],
      failed,
      'resolver',
      { directP2p: false },
    )).toEqual([otherReleaseSameAddon, sameReleaseOtherAddon])
  })

  it('does not retry rejected debrid credentials on another hash', () => {
    const failed = torrent('addon-a', 'a')
    const anotherHash = torrent('addon-b', 'b')
    const direct = stream('direct-http')
    expect(planRecoveryCandidates(
      [anotherHash, direct],
      failed,
      'auth',
      { directP2p: false },
    )).toEqual([direct])
  })

  it('changes bytes before retrying the same release after a player failure', () => {
    const failed = {
      ...torrent('addon-a', 'a'),
      __candidate: { releaseId: 'release-a', offerId: 'failed', routeId: 'failed', offerCount: 2, routeCount: 2 },
    }
    const sameRelease = {
      ...torrent('addon-b', 'a'),
      __candidate: { releaseId: 'release-a', offerId: 'same', routeId: 'same', offerCount: 2, routeCount: 2 },
    }
    const otherRelease = {
      ...torrent('addon-a', 'b'),
      __candidate: { releaseId: 'release-b', offerId: 'other', routeId: 'other', offerCount: 1, routeCount: 1 },
    }
    expect(planRecoveryCandidates(
      [sameRelease, otherRelease],
      failed,
      'player',
      { directP2p: true },
    )).toEqual([otherRelease, sameRelease])
  })

  it('never retries the same bytes when the release is unsupported', () => {
    const [failed, sameBytes, different] = normalizeCandidates([
      torrent('one', 'a'),
      torrent('two', 'a'),
      torrent('one', 'b'),
    ])
    expect(planRecoveryCandidates([sameBytes, different], failed, 'unsupported', { directP2p: true })).toEqual([different])
  })

  it('does not promote a lower-quality alternate while diversifying recovery', () => {
    const failed = stream('failed')
    const preferred = stream('preferred')
    const lowerSameRelease = stream('lower', 720, {
      __candidate: { releaseId: 'same', offerId: 'lower', routeId: 'lower', offerCount: 2, routeCount: 2 },
    })
    const preferredWithRelease = {
      ...preferred,
      __candidate: { releaseId: 'other', offerId: 'preferred', routeId: 'preferred', offerCount: 1, routeCount: 1 },
    }
    const failedWithRelease = {
      ...failed,
      __candidate: { releaseId: 'same', offerId: 'failed', routeId: 'failed', offerCount: 2, routeCount: 2 },
    }
    expect(planRecoveryCandidates(
      [preferredWithRelease, lowerSameRelease],
      failedWithRelease,
      'stalled',
      { directP2p: false },
    )).toEqual([preferredWithRelease, lowerSameRelease])
  })
})
