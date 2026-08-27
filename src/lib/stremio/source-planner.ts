import type { PlaybackTransport, SourceOutcomeSummary } from '$lib/player/source-outcomes'
import { describe, languageMismatch, type Stream } from './addon'
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
  audioLang?: string
  sourcePriority?: readonly string[]
  outcomeOf?: (stream: Stream, transport: PlaybackTransport) => SourceOutcomeSummary | undefined
  now?: number
}

const MIN_LOCAL_OBSERVATIONS = 3
const MAX_BUCKET_SHIFT = 2
const LOCAL_HALF_LIFE_MS = 45 * 24 * 60 * 60 * 1_000

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

function localSignals(summary: SourceOutcomeSummary | undefined, now: number): SourcePlanSignal[] {
  if (!summary) return []
  const observations = summary.stable + summary.failures
  if (observations < MIN_LOCAL_OBSERVATIONS) return []

  // Beta(2,2) smoothing stops a tiny history becoming certainty. Recent evidence matters more;
  // after 45 days without another attempt its influence halves instead of becoming a permanent
  // provider blacklist.
  const stableRate = (summary.stable + 2) / (observations + 4)
  const age = Math.max(0, now - summary.lastAt)
  const recency = 0.5 ** (age / LOCAL_HALF_LIFE_MS)
  const reliability = clamp((stableRate - 0.5) * 16 * recency, -6, 6)
  const signals: SourcePlanSignal[] = []
  if (Math.abs(reliability) >= 0.25) {
    signals.push({
      label: reliability >= 0
        ? `${summary.stable}/${observations} locally observed starts became stable`
        : `${summary.failures}/${observations} locally observed starts failed`,
      delta: reliability,
    })
  }

  // Startup speed is considered only after three measured first frames and is deliberately much
  // weaker than reliability. A fast source that often fails is still a bad first choice.
  if (summary.firstFrames >= MIN_LOCAL_OBSERVATIONS && summary.firstFrameMs != null) {
    const speed = summary.firstFrameMs <= 3_000 ? 1.5
      : summary.firstFrameMs <= 7_000 ? 0.75
        : summary.firstFrameMs >= 20_000 ? -1.5
          : summary.firstFrameMs >= 12_000 ? -0.75
            : 0
    if (speed) {
      signals.push({
        label: speed > 0
          ? `usually starts in about ${(summary.firstFrameMs / 1_000).toFixed(1)}s`
          : `usually takes about ${Math.round(summary.firstFrameMs / 1_000)}s to start`,
        delta: speed * recency,
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
  if (evidence.confirmedMatch === true) signals.push({ label: 'provider confirmed the episode match', delta: 0.75 })
  if (evidence.bestRelease === true) signals.push({ label: 'provider marked it as a best release', delta: 1 })
  if (evidence.upstreamRank === 0) signals.push({ label: 'provider returned it first', delta: 0.25 })
  return signals
}

function confidenceOf(summary?: SourceOutcomeSummary): SourcePlanConfidence {
  const observations = (summary?.stable ?? 0) + (summary?.failures ?? 0)
  return observations >= 8 ? 'high' : observations >= MIN_LOCAL_OBSERVATIONS ? 'medium' : 'low'
}

interface ScoredSource {
  stream: Stream
  original: number
  score: number
  confidence: SourcePlanConfidence
  signals: SourcePlanSignal[]
}

/** Sort one safety-equivalent bucket while limiting every source to two bucket positions. */
function boundedOrder(input: ScoredSource[]): ScoredSource[] {
  const remaining = [...input]
  const out: ScoredSource[] = []
  for (let position = 0; position < input.length; position++) {
    const eligible = remaining.filter((candidate) => candidate.original <= position + MAX_BUCKET_SHIFT)
    const due = eligible.filter((candidate) => candidate.original + MAX_BUCKET_SHIFT <= position)
    const pool = due.length ? due : eligible
    pool.sort((a, b) => b.score - a.score || a.original - b.original)
    const chosen = pool[0]
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
  const now = options.now ?? Date.now()
  const scored = baseline.map((stream, original): ScoredSource => {
    const transport = plannedTransport(stream, options.directP2p)
    const summary = options.outcomeOf?.(stream, transport)
    const signals = [...localSignals(summary, now), ...providerSignals(stream)]
    return {
      stream,
      original,
      score: clamp(signals.reduce((sum, signal) => sum + signal.delta, 0), -8, 8),
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
  const orderedBuckets = new Map([...buckets].map(([key, bucket]) => [key, boundedOrder(bucket)]))
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
      baselineIndex: details.original,
      plannedIndex,
      adaptiveScore: details.score,
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
