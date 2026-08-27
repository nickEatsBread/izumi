import { describe, expect, it } from 'vitest'
import type { PlaybackTransport, SourceOutcomeCounts, SourceOutcomeSummary } from '$lib/player/source-outcomes'
import { planSources } from './source-planner'
import type { Stream } from './parse'

const baseline: Stream = {
  url: 'https://baseline.example/video.mkv',
  title: 'Show - 01 1080p',
  __origin: { kind: 'online-extension', id: 'baseline' },
}
const challenger: Stream = {
  url: 'https://challenger.example/video.mkv',
  title: 'Show - 01 1080p',
  __origin: { kind: 'online-extension', id: 'challenger' },
}

function counts(successes: number, failures: number): SourceOutcomeCounts {
  return {
    attempts: successes + failures,
    startupSuccesses: successes,
    startupFailures: failures,
    stableSuccesses: successes,
    playbackFailures: 0,
    cancellations: 0,
    failureClasses: failures ? { stalled: failures } : {},
    resolveSamples: 0,
    firstFrameSamples: 0,
  }
}

function summary(sourceId: string, successes: number, failures: number): SourceOutcomeSummary {
  return {
    context: { family: 'online-extension', sourceId, transport: 'http' },
    automatic: counts(successes, failures),
    manual: counts(0, 0),
    evidenceAt: 0,
    lastAt: 0,
  }
}

function generator(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x1_0000_0000
  }
}

interface RepeatedComparison {
  everPromoted: number
  promotedByEnd: number
  meanFirstPromotion?: number
}

function repeatedComparison(
  baselineRate: number,
  challengerRate: number,
  runs = 2_000,
  horizon = 64,
): RepeatedComparison {
  const random = generator(0x51a7e ^ Math.round(baselineRate * 1_000) ^ Math.round(challengerRate * 10_000))
  let everPromoted = 0
  let promotedByEnd = 0
  let promotionRounds = 0
  for (let run = 0; run < runs; run++) {
    let baselineSuccesses = 0
    let challengerSuccesses = 0
    let firstPromotion: number | undefined
    let promotedAtEnd = false
    for (let round = 1; round <= horizon; round++) {
      if (random() < baselineRate) baselineSuccesses++
      if (random() < challengerRate) challengerSuccesses++
      const summaries = new Map<Stream, SourceOutcomeSummary>([
        [baseline, summary('baseline', baselineSuccesses, round - baselineSuccesses)],
        [challenger, summary('challenger', challengerSuccesses, round - challengerSuccesses)],
      ])
      const plan = planSources([baseline, challenger], {
        directP2p: false,
        outcomeOf: (stream: Stream, _transport: PlaybackTransport) => summaries.get(stream),
      })
      const promoted = plan.planned[0] === challenger
      if (promoted && firstPromotion == null) firstPromotion = round
      if (round === horizon) promotedAtEnd = promoted
    }
    if (firstPromotion != null) {
      everPromoted++
      promotionRounds += firstPromotion
    }
    if (promotedAtEnd) promotedByEnd++
  }
  return {
    everPromoted: everPromoted / runs,
    promotedByEnd: promotedByEnd / runs,
    meanFirstPromotion: everPromoted ? promotionRounds / everPromoted : undefined,
  }
}

describe('adaptive planner stochastic calibration', () => {
  it('rarely promotes an equal or worse challenger under repeated inspection', () => {
    // These are model-based guardrails, not claims about production QoE: independent Bernoulli
    // outcomes are deliberately simpler than real correlated provider/network failures.
    const equal = repeatedComparison(0.8, 0.8)
    const worse = repeatedComparison(0.8, 0.7)
    expect(equal.everPromoted).toBeLessThan(0.02)
    expect(worse.everPromoted).toBeLessThan(0.01)
    expect(worse.promotedByEnd).toBeLessThan(0.002)
  }, 15_000)

  it('eventually detects a material reliability improvement', () => {
    const better = repeatedComparison(0.7, 0.9)
    expect(better.promotedByEnd).toBeGreaterThan(0.4)
    expect(better.meanFirstPromotion).toBeGreaterThanOrEqual(8)
  })

  it('detects an overwhelming improvement within a short history', () => {
    const better = repeatedComparison(0.3, 0.95, 2_000, 16)
    expect(better.promotedByEnd).toBeGreaterThan(0.75)
  })
})
