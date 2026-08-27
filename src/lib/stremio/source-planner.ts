import { effectiveOutcomeTrials, MANUAL_OUTCOME_WEIGHT, type PlaybackFailureClass, type PlaybackTransport, type SourceOutcomeCounts, type SourceOutcomeSummary } from '$lib/player/source-outcomes'
import { describe, languageMismatch, type Stream } from './addon'
import { candidateIds } from './candidate-model'
import { priorityIndexOf } from './source-priority'
import { torrentioResolverInfoHash } from './resolver-url'

export type SourcePlanConfidence = 'low' | 'medium' | 'high'

export interface SourcePlanSignal {
  label: string
  /** A bounded, relative preference. It is never allowed to cross a hard constraint. */
  delta: number
}

export interface PlannedSource {
  stream: Stream
  baselineIndex: number
  plannedIndex: number
  /** Posterior reliability minus the bounded startup-latency penalty. */
  adaptiveScore: number
  confidence: SourcePlanConfidence
  signals: SourcePlanSignal[]
}

export interface SourcePlan {
  baseline: Stream[]
  planned: Stream[]
  candidates: PlannedSource[]
  changed: boolean
  headChanged: boolean
  explanation: string
}

export interface SourcePlannerOptions {
  directP2p: boolean
  /** Shadow may expose a promising uncertain challenger; active requires conservative confidence. */
  policy?: 'preview' | 'active'
  audioLang?: string
  sourcePriority?: readonly string[]
  outcomeOf?: (stream: Stream, transport: PlaybackTransport) => SourceOutcomeSummary | undefined
  now?: number
}

const MIN_PREVIEW_OBSERVATIONS = 3
const MIN_ACTIVE_OBSERVATIONS = 8
const MAX_BUCKET_SHIFT = 2
const ONE_SIDED_95_Z = 1.644853626951
const ACTIVE_MARGIN = 0.015

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Match the transport identity used by playback telemetry without importing the playback engine. */
export function plannedTransport(stream: Stream, directP2p: boolean): PlaybackTransport {
  const resolverHash = torrentioResolverInfoHash(stream.url, stream.__addonName ?? stream.name)
  if ((!stream.url && stream.infoHash) || resolverHash) return directP2p ? 'direct-p2p' : 'debrid'
  if (stream.__drm) return 'drm'
  if (stream.__manifest === 'dash' || /\.mpd(?:[?#]|$)/i.test(stream.url ?? '')) return 'dash'
  if (stream.__manifest === 'hls' || /\.m3u8(?:[?#]|$)/i.test(stream.url ?? '')) return 'hls'
  if (stream.url) return 'http'
  if (stream.externalUrl || stream.ytId) return 'external'
  return 'unknown'
}

function hardConstraintKey(stream: Stream, options: SourcePlannerOptions): string {
  const info = describe(stream)
  const priority = options.sourcePriority?.length
    ? priorityIndexOf(stream, options.sourcePriority)
    : -1
  // Exact cache state, resolution, language compatibility and an explicitly stated source order
  // are walls, not weights. Learning may only exchange rows whose complete key is identical.
  return [info.cached, info.quality, languageMismatch(info, options.audioLang), priority].join('|')
}

const weighted = (automatic: SourceOutcomeCounts, manual: SourceOutcomeCounts, field: keyof Pick<
  SourceOutcomeCounts,
  'startupSuccesses' | 'startupFailures' | 'stableSuccesses' | 'playbackFailures' | 'firstFrameSamples'
>) => automatic[field] + manual[field] * MANUAL_OUTCOME_WEIGHT

function providerPseudoSuccesses(stream: Stream): number {
  const evidence = stream.__evidence
  if (!evidence) return 0
  return (evidence.confirmedMatch === true ? 0.25 : 0)
    + (evidence.bestRelease === true ? 0.35 : 0)
    + (evidence.upstreamRank === 0 ? 0.1 : 0)
}

interface ReliabilityEstimate {
  effective: number
  mean: number
  lower: number
  upper: number
  latencyMs?: number
  latencySamples: number
  providerPrior: number
}

function betaEstimate(successes: number, failures: number): { mean: number; lower: number; upper: number } {
  const alpha = 2 + successes
  const beta = 2 + failures
  const total = alpha + beta
  const mean = alpha / total
  const deviation = Math.sqrt((alpha * beta) / (total * total * (total + 1))) * ONE_SIDED_95_Z
  return { mean, lower: clamp(mean - deviation, 0, 1), upper: clamp(mean + deviation, 0, 1) }
}

function reliabilityEstimate(summary: SourceOutcomeSummary | undefined, stream: Stream): ReliabilityEstimate {
  const providerPrior = providerPseudoSuccesses(stream)
  if (!summary) {
    const startup = betaEstimate(providerPrior, 0)
    return { ...startup, effective: 0, latencySamples: 0, providerPrior }
  }
  const startupSuccesses = weighted(summary.automatic, summary.manual, 'startupSuccesses')
  const startupFailures = weighted(summary.automatic, summary.manual, 'startupFailures')
  const stableSuccesses = weighted(summary.automatic, summary.manual, 'stableSuccesses')
  const playbackFailures = weighted(summary.automatic, summary.manual, 'playbackFailures')
  const startup = betaEstimate(startupSuccesses + providerPrior, startupFailures)
  const sustainedTrials = stableSuccesses + playbackFailures
  const sustained = betaEstimate(stableSuccesses, playbackFailures)
  // Starting at all dominates the decision. Sustained playback becomes a second independent
  // objective only after it has real observations; censored/short sessions add no negative label.
  const mix = sustainedTrials >= 2 ? 0.2 : 0
  // Stability is conditional on startup, not an alternative success path. Its posterior may
  // discount startup reliability but must never lift a route which rarely starts in the first
  // place (which a weighted arithmetic mean incorrectly allowed).
  const composite = (startupValue: number, sustainedValue: number) =>
    startupValue * ((1 - mix) + sustainedValue * mix)
  const automaticLatencySamples = summary.automatic.firstFrameSamples
  const manualLatencySamples = summary.manual.firstFrameSamples * MANUAL_OUTCOME_WEIGHT
  const latencySamples = automaticLatencySamples + manualLatencySamples
  const latencyMs = latencySamples > 0
    ? Math.round(
        ((summary.automatic.firstFrameMs ?? 0) * automaticLatencySamples
          + (summary.manual.firstFrameMs ?? 0) * manualLatencySamples) / latencySamples,
      )
    : undefined
  return {
    effective: effectiveOutcomeTrials(summary),
    mean: composite(startup.mean, sustained.mean),
    lower: composite(startup.lower, sustained.lower),
    upper: composite(startup.upper, sustained.upper),
    latencyMs,
    latencySamples,
    providerPrior,
  }
}

function latencyPenalty(estimate: ReliabilityEstimate): number {
  if (estimate.latencyMs == null || estimate.latencySamples < MIN_PREVIEW_OBSERVATIONS) return 0
  // Roughly ±6 percentage points around a five-second neutral point. Reliability remains primary;
  // latency settles choices that are otherwise close, as in peak-EWMA endpoint balancing.
  return clamp(Math.log2(estimate.latencyMs / 5_000) * 0.04, -0.06, 0.12)
}

function localSignals(summary: SourceOutcomeSummary | undefined, estimate: ReliabilityEstimate): SourcePlanSignal[] {
  if (!summary || estimate.effective < MIN_PREVIEW_OBSERVATIONS) return []
  const reliability = clamp((estimate.mean - 0.5) * 12, -5, 5)
  const signals: SourcePlanSignal[] = []
  if (Math.abs(reliability) >= 0.25) {
    signals.push({
      label: reliability >= 0
        ? `about ${Math.round(estimate.mean * 100)}% reliable across ${estimate.effective.toFixed(1)} recent weighted starts`
        : `only about ${Math.round(estimate.mean * 100)}% reliable across ${estimate.effective.toFixed(1)} recent weighted starts`,
      delta: reliability,
    })
  }

  if (estimate.latencySamples >= MIN_PREVIEW_OBSERVATIONS && estimate.latencyMs != null) {
    const speed = estimate.latencyMs <= 3_000 ? 0.75
      : estimate.latencyMs <= 7_000 ? 0.35
        : estimate.latencyMs >= 20_000 ? -0.75
          : estimate.latencyMs >= 12_000 ? -0.35
            : 0
    if (speed) {
      signals.push({
        label: speed > 0
          ? `recent starts take about ${(estimate.latencyMs / 1_000).toFixed(1)}s`
          : `recent starts take about ${Math.round(estimate.latencyMs / 1_000)}s`,
        delta: speed,
      })
    }
  }
  return signals
}

function providerSignals(stream: Stream): SourcePlanSignal[] {
  const evidence = stream.__evidence
  if (!evidence) return []
  const signals: SourcePlanSignal[] = []
  // These are source-native claims, useful but weak: a provider can know its own match/release,
  // while independent local playback evidence and human curation remain stronger.
  if (evidence.confirmedMatch === true) signals.push({ label: 'provider confirmed the episode match', delta: 0.25 })
  if (evidence.bestRelease === true) signals.push({ label: 'provider marked it as a best release', delta: 0.35 })
  if (evidence.upstreamRank === 0) signals.push({ label: 'provider returned it first', delta: 0.1 })
  return signals
}

function confidenceOf(summary?: SourceOutcomeSummary): SourcePlanConfidence {
  const observations = summary ? effectiveOutcomeTrials(summary) : 0
  return observations >= 16 ? 'high' : observations >= MIN_ACTIVE_OBSERVATIONS ? 'medium' : 'low'
}

interface ScoredSource {
  stream: Stream
  baselineIndex: number
  /** Position inside the safety-equivalent bucket used by the movement bound. */
  original: number
  score: number
  estimate: ReliabilityEstimate
  confidence: SourcePlanConfidence
  signals: SourcePlanSignal[]
}

function canPromote(challenger: ScoredSource, incumbent: ScoredSource, policy: 'preview' | 'active'): boolean {
  if (policy === 'active') {
    // Conservative-bandit gate: the challenger must have real local evidence and its pessimistic
    // value must beat the incumbent's optimistic value. Provider self-claims can shape the prior,
    // but can never activate a source by themselves.
    return challenger.estimate.effective >= MIN_ACTIVE_OBSERVATIONS
      && challenger.estimate.lower - latencyPenalty(challenger.estimate)
        > incumbent.estimate.upper - latencyPenalty(incumbent.estimate) + ACTIVE_MARGIN
  }
  // Shadow is the evaluation surface: show a plausible counterfactual after a few observations,
  // or a weak provider-prior challenger, without changing playback.
  const challengerValue = challenger.estimate.mean - latencyPenalty(challenger.estimate)
  const incumbentValue = incumbent.estimate.mean - latencyPenalty(incumbent.estimate)
  return (challenger.estimate.effective >= MIN_PREVIEW_OBSERVATIONS
      && challengerValue > incumbentValue + ACTIVE_MARGIN)
    || (challenger.estimate.providerPrior > incumbent.estimate.providerPrior
      && challengerValue > incumbentValue)
}

/** Conservative interleaving inside one safety-equivalent bucket, capped at two positions. */
function boundedOrder(input: ScoredSource[], policy: 'preview' | 'active'): ScoredSource[] {
  const remaining = [...input]
  const out: ScoredSource[] = []
  for (let position = 0; position < input.length; position++) {
    const eligible = remaining.filter((candidate) => candidate.original <= position + MAX_BUCKET_SHIFT)
    const due = eligible.filter((candidate) => candidate.original + MAX_BUCKET_SHIFT <= position)
    const incumbent = remaining.reduce((first, candidate) => candidate.original < first.original ? candidate : first)
    const challengers = eligible
      .filter((candidate) => candidate !== incumbent && canPromote(candidate, incumbent, policy))
      .sort((a, b) => b.score - a.score || a.original - b.original)
    // The due arm preserves the movement bound. Otherwise retain the baseline unless a challenger
    // cleared the confidence gate; this avoids bandit exploration at the user's expense.
    const chosen = due[0] ?? challengers[0] ?? incumbent
    out.push(chosen)
    remaining.splice(remaining.indexOf(chosen), 1)
  }
  return out
}

function planExplanation(planned: ScoredSource, baseline: ScoredSource): string {
  const positive = planned.signals.filter((signal) => signal.delta > 0).sort((a, b) => b.delta - a.delta)
  const negative = baseline.signals.filter((signal) => signal.delta < 0).sort((a, b) => a.delta - b.delta)
  const parts = [
    ...positive.slice(0, 2).map((signal) => signal.label),
    ...negative.slice(0, 1).map((signal) => `the usual first source ${signal.label}`),
  ]
  return parts.join('; ') || 'it has stronger bounded source evidence'
}

/**
 * Produce an adaptive order without mutating its baseline. Callers decide whether the plan is a
 * preview or active policy; this function has no side effects and never performs network/LLM work.
 */
export function planSources(baseline: Stream[], options: SourcePlannerOptions): SourcePlan {
  const policy = options.policy ?? 'active'
  const scored = baseline.map((stream, original): ScoredSource => {
    const transport = plannedTransport(stream, options.directP2p)
    const summary = options.outcomeOf?.(stream, transport)
    const estimate = reliabilityEstimate(summary, stream)
    const signals = [...localSignals(summary, estimate), ...providerSignals(stream)]
    return {
      stream,
      baselineIndex: original,
      original,
      score: estimate.mean - latencyPenalty(estimate),
      estimate,
      confidence: confidenceOf(summary),
      signals,
    }
  })

  const buckets = new Map<string, ScoredSource[]>()
  scored.forEach((candidate) => {
    const key = hardConstraintKey(candidate.stream, options)
    const bucket = buckets.get(key) ?? []
    bucket.push({ ...candidate, original: bucket.length })
    buckets.set(key, bucket)
  })
  const orderedBuckets = new Map([...buckets].map(([key, bucket]) => [key, boundedOrder(bucket, policy)]))
  const cursors = new Map<string, number>()
  const plannedScored = scored.map((candidate) => {
    const key = hardConstraintKey(candidate.stream, options)
    const cursor = cursors.get(key) ?? 0
    cursors.set(key, cursor + 1)
    return orderedBuckets.get(key)![cursor]
  })
  const planned = plannedScored.map((candidate) => candidate.stream)
  const changed = planned.some((stream, index) => stream !== baseline[index])
  const headChanged = planned[0] !== baseline[0]
  const byStream = new Map(scored.map((candidate) => [candidate.stream, candidate]))
  const candidates = plannedScored.map((candidate, plannedIndex): PlannedSource => {
    const details = byStream.get(candidate.stream)!
    return {
      stream: candidate.stream,
      baselineIndex: details.baselineIndex,
      plannedIndex,
      adaptiveScore: Math.round(details.score * 1_000) / 1_000,
      confidence: details.confidence,
      signals: details.signals,
    }
  })
  return {
    baseline: [...baseline],
    planned,
    candidates,
    changed,
    headChanged,
    explanation: headChanged && plannedScored[0] && scored[0]
      ? planExplanation(byStream.get(plannedScored[0].stream)!, scored[0])
      : '',
  }
}

const releaseIdOf = (stream: Stream) => stream.__candidate?.releaseId ?? candidateIds(stream).releaseId
const sourceIdOf = (stream: Stream) => stream.__origin?.id ?? ''

function diversifyReleases(candidates: Stream[]): Stream[] {
  const groups = new Map<string, Stream[]>()
  for (const candidate of candidates) {
    const key = releaseIdOf(candidate)
    const group = groups.get(key) ?? []
    group.push(candidate)
    groups.set(key, group)
  }
  const out: Stream[] = []
  let depth = 0
  while (out.length < candidates.length) {
    for (const group of groups.values()) {
      if (group[depth]) out.push(group[depth])
    }
    depth++
  }
  return out
}

function withinConstraintBuckets(
  candidates: Stream[],
  options: SourcePlannerOptions,
  order: (bucket: Stream[]) => Stream[],
): Stream[] {
  const buckets = new Map<string, Stream[]>()
  for (const candidate of candidates) {
    const key = hardConstraintKey(candidate, options)
    const bucket = buckets.get(key) ?? []
    bucket.push(candidate)
    buckets.set(key, bucket)
  }
  const ordered = new Map([...buckets].map(([key, bucket]) => [key, order(bucket)]))
  const cursors = new Map<string, number>()
  return candidates.map((candidate) => {
    const key = hardConstraintKey(candidate, options)
    const cursor = cursors.get(key) ?? 0
    cursors.set(key, cursor + 1)
    return ordered.get(key)![cursor]
  })
}

/**
 * Turn a ranked candidate list into a diagnosis-aware recovery list. Wrong bytes require another
 * release; a route/transport failure gets one alternate route before release diversity; a
 * provider-wide auth/geo/policy fault moves that provider behind independent alternatives.
 */
export function planRecoveryCandidates(
  candidates: Stream[],
  failed: Stream | undefined,
  failureClass: PlaybackFailureClass,
  options: SourcePlannerOptions,
): Stream[] {
  if (!failed) return withinConstraintBuckets(candidates, options, diversifyReleases)
  const failedRelease = releaseIdOf(failed)
  const failedSource = sourceIdOf(failed)
  const failedTransport = plannedTransport(failed, options.directP2p)

  if (failureClass === 'wrong-content' || failureClass === 'unsupported') {
    return withinConstraintBuckets(
      candidates.filter((candidate) => releaseIdOf(candidate) !== failedRelease),
      options,
      diversifyReleases,
    )
  }

  // A debrid credential failure applies to the configured service, not the addon which happened to
  // discover a hash. Retrying more hashes through the same rejected credential only burns the
  // bounded retry budget; retain any independently playable HTTP/P2P alternatives.
  if (failureClass === 'auth' && failedTransport === 'debrid') {
    return withinConstraintBuckets(
      candidates.filter((candidate) => plannedTransport(candidate, options.directP2p) !== 'debrid'),
      options,
      diversifyReleases,
    )
  }

  if (failureClass === 'resolver' && failedTransport === 'debrid') {
    return withinConstraintBuckets(candidates, options, (bucket) => {
      const otherReleases = bucket.filter((candidate) => releaseIdOf(candidate) !== failedRelease)
      const sameRelease = bucket.filter((candidate) => releaseIdOf(candidate) === failedRelease)
      return [...diversifyReleases(otherReleases), ...sameRelease]
    })
  }

  if (failureClass === 'auth' || failureClass === 'geo' || failureClass === 'policy' || failureClass === 'resolver') {
    return withinConstraintBuckets(candidates, options, (bucket) => {
      const independent = bucket.filter((candidate) => !failedSource || sourceIdOf(candidate) !== failedSource)
      const sameSource = bucket.filter((candidate) => !!failedSource && sourceIdOf(candidate) === failedSource)
      return [...diversifyReleases(independent), ...diversifyReleases(sameSource)]
    })
  }

  if (failureClass === 'player') {
    return withinConstraintBuckets(candidates, options, (bucket) => {
      const otherReleases = bucket.filter((candidate) => releaseIdOf(candidate) !== failedRelease)
      const sameRelease = bucket.filter((candidate) => releaseIdOf(candidate) === failedRelease)
      // A decoder/container failure usually follows the bytes. Change encode before retrying an
      // alternate route to the same file, while retaining that route as a last resort for generic
      // player load errors which were really transport failures.
      return [...diversifyReleases(otherReleases), ...sameRelease]
    })
  }

  if (failureClass === 'transport' || failureClass === 'stalled' || failureClass === 'metadata') {
    return withinConstraintBuckets(candidates, options, (bucket) => {
      const sameRelease = bucket.filter((candidate) => releaseIdOf(candidate) === failedRelease)
      const otherReleases = bucket.filter((candidate) => releaseIdOf(candidate) !== failedRelease)
      // One alternate route can preserve the chosen encode/subtitles while escaping a dead CDN,
      // tracker or offer. More than one before another release would spend the whole retry budget
      // on the same underlying bytes.
      return [...sameRelease.slice(0, 1), ...diversifyReleases(otherReleases), ...sameRelease.slice(1)]
    })
  }

  return withinConstraintBuckets(candidates, options, diversifyReleases)
}
