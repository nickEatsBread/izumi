import { get } from 'svelte/store'
import { debridProvider, saveLocalHistory } from '$lib/settings/ui'
import { incognito } from '$lib/stores/incognito'
import { describe, type Stream } from '$lib/stremio/parse'

export type PlaybackTransport = 'direct-p2p' | 'debrid' | 'http' | 'hls' | 'dash' | 'drm' | 'external' | 'offline' | 'unknown'
export type PlaybackObservationStage = 'selected' | 'resolving' | 'resolved' | 'player-ready' | 'first-frame' | 'stable' | 'completed'
export type PlaybackFailureClass = 'no-results' | 'metadata' | 'resolver' | 'transport' | 'player' | 'stalled' | 'wrong-content' | 'auth' | 'geo' | 'policy' | 'unsupported' | 'unknown'

export interface SourceOutcomeContext {
  /** Addon/extension family, not a title or release identifier. */
  family: string
  /** Existing opaque addon fingerprint or stable extension id. */
  sourceId: string
  transport: PlaybackTransport
  /** Digest of a provider server/hostname; the hostname itself is never persisted. */
  serverId?: string
  /** Digest of the selected resolver/debrid service. Kept separate from the addon that found it. */
  serviceId?: string
  /** Digest of a reusable route profile (release group/readiness/size), never a title or hash. */
  profileId?: string
  language?: string
}

export interface SourceOutcomeCounts {
  attempts: number
  startupSuccesses: number
  startupFailures: number
  stableSuccesses: number
  playbackFailures: number
  cancellations: number
  failureClasses: Partial<Record<PlaybackFailureClass, number>>
  resolveSamples: number
  firstFrameSamples: number
  resolveMs?: number
  firstFrameMs?: number
}

export interface SourceOutcomeSummary {
  context: SourceOutcomeContext
  automatic: SourceOutcomeCounts
  manual: SourceOutcomeCounts
  /** Timestamp at which the decayed sufficient statistics above are materialized. */
  evidenceAt: number
  lastAt: number
}

export interface PlaybackObservationEvent {
  attemptId: number
  at: number
  stage: PlaybackObservationStage | 'failed' | 'canceled'
  contextKey: string
  automatic: boolean
  failureClass?: PlaybackFailureClass
  failedAt?: PlaybackObservationStage
}

export interface PlaybackObservation {
  readonly id: number
  readonly context: SourceOutcomeContext
  readonly contextKey: string
  readonly contexts: readonly SourceOutcomeContext[]
  readonly contextKeys: readonly string[]
  readonly automatic: boolean
  readonly startedAt: number
  stage: PlaybackObservationStage
  seen: Set<PlaybackObservationStage>
  stableAt?: number
  terminal: boolean
}

export interface PlaybackStabilityState {
  lastPosition?: number
  advancedSeconds: number
}

/** Count genuine forward playback while ignoring seek-sized clock jumps. */
export function advancePlaybackStability(
  state: PlaybackStabilityState,
  position: number,
  stableAfterSeconds = 30,
): { state: PlaybackStabilityState; stable: boolean } {
  const delta = state.lastPosition == null ? 0 : position - state.lastPosition
  const advancedSeconds = state.advancedSeconds + (delta > 0 && delta <= 10 ? delta : 0)
  return {
    state: { lastPosition: position, advancedSeconds },
    stable: advancedSeconds >= stableAfterSeconds,
  }
}

export interface OutcomeStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const STORAGE_KEY = 'source-outcomes-v2'
const LEGACY_STORAGE_KEYS = ['source-outcomes-v1']
const MAX_SUMMARIES = 256
const MAX_SESSION_EVENTS = 256
/** Provider behaviour changes abruptly; discounted bandits avoid treating old regimes as current. */
export const OUTCOME_HALF_LIFE_MS = 21 * 24 * 60 * 60 * 1_000
/** Manual choices are informative but sampled under user-selection bias, so they count less. */
export const MANUAL_OUTCOME_WEIGHT = 0.25

function digest(text: string): string {
  let a = 0x811c9dc5
  let b = 0x9e3779b9
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    a = Math.imul(a ^ code, 0x01000193)
    b = Math.imul(b ^ code, 0x85ebca6b)
  }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`
}

function contextKey(context: SourceOutcomeContext): string {
  return `ctx-${digest([
    context.family,
    context.sourceId,
    context.transport,
    context.serverId ?? '',
    context.serviceId ?? '',
    context.profileId ?? '',
    context.language ?? '',
  ].join('|'))}`
}

function blankCounts(): SourceOutcomeCounts {
  return {
    attempts: 0,
    startupSuccesses: 0,
    startupFailures: 0,
    stableSuccesses: 0,
    playbackFailures: 0,
    cancellations: 0,
    failureClasses: {},
    resolveSamples: 0,
    firstFrameSamples: 0,
  }
}

function blank(context: SourceOutcomeContext, at: number): SourceOutcomeSummary {
  return {
    context,
    automatic: blankCounts(),
    manual: blankCounts(),
    evidenceAt: at,
    lastAt: at,
  }
}

type DecayedCountField = 'attempts' | 'startupSuccesses' | 'startupFailures'
  | 'stableSuccesses' | 'playbackFailures' | 'cancellations' | 'resolveSamples' | 'firstFrameSamples'
const decayedFields: readonly DecayedCountField[] = [
  'attempts', 'startupSuccesses', 'startupFailures', 'stableSuccesses',
  'playbackFailures', 'cancellations', 'resolveSamples', 'firstFrameSamples',
]

function decayCounts(counts: SourceOutcomeCounts, factor: number): void {
  for (const field of decayedFields) counts[field] *= factor
  for (const failure of Object.keys(counts.failureClasses) as PlaybackFailureClass[]) {
    counts.failureClasses[failure] = (counts.failureClasses[failure] ?? 0) * factor
  }
}

function materialize(summary: SourceOutcomeSummary, at: number): void {
  const elapsed = at - summary.evidenceAt
  // Wall clocks can move backwards. Never rewind the evidence epoch, because doing so would make
  // the next forward tick decay the same interval twice.
  if (elapsed <= 0) return
  const factor = 0.5 ** (elapsed / OUTCOME_HALF_LIFE_MS)
  decayCounts(summary.automatic, factor)
  decayCounts(summary.manual, factor)
  summary.evidenceAt = at
}

function projected(summary: SourceOutcomeSummary, at: number): SourceOutcomeSummary {
  const cloneCounts = (counts: SourceOutcomeCounts): SourceOutcomeCounts => ({
    ...counts,
    failureClasses: { ...counts.failureClasses },
  })
  const copy: SourceOutcomeSummary = {
    ...summary,
    context: { ...summary.context },
    automatic: cloneCounts(summary.automatic),
    manual: cloneCounts(summary.manual),
  }
  materialize(copy, at)
  return copy
}

/** Peak-weighted EWMA: slow starts affect the estimate immediately; repeated fast starts heal it. */
function latencyEstimate(previous: number | undefined, priorSamples: number, sample: number): number {
  if (previous == null || priorSamples <= 0) return Math.round(sample)
  const weight = Math.min(7, priorSamples)
  const average = (previous * weight + sample) / (weight + 1)
  return Math.round(Math.max(sample, average))
}

function baseContext(context: SourceOutcomeContext): SourceOutcomeContext {
  const { serverId: _server, profileId: _profile, ...base } = context
  return base
}

function contextHierarchy(context: SourceOutcomeContext): SourceOutcomeContext[] {
  const detailed = context
  const base = baseContext(context)
  return contextKey(detailed) === contextKey(base) ? [detailed] : [detailed, base]
}

/** Bounded aggregate journal. No event history is persisted; staged events are session-only. */
export class SourceOutcomeJournal {
  private summaries: Record<string, SourceOutcomeSummary> | null = null
  private events: PlaybackObservationEvent[] = []
  private sequence = 0

  constructor(
    private readonly storage?: OutcomeStorage,
    private readonly canObserve: () => boolean = () => true,
    private readonly now: () => number = Date.now,
  ) {}

  private load(): Record<string, SourceOutcomeSummary> {
    if (this.summaries) return this.summaries
    this.summaries = {}
    try {
      for (const stale of LEGACY_STORAGE_KEYS) this.storage?.removeItem(stale)
      const raw = this.storage?.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          this.summaries = parsed as Record<string, SourceOutcomeSummary>
        }
      }
    } catch { this.summaries = {} }
    return this.summaries
  }

  private save(): void {
    if (!this.summaries || !this.storage || !this.canObserve()) return
    const entries = Object.entries(this.summaries)
      .sort(([, a], [, b]) => b.lastAt - a.lastAt)
      .slice(0, MAX_SUMMARIES)
    this.summaries = Object.fromEntries(entries)
    try { this.storage.setItem(STORAGE_KEY, JSON.stringify(this.summaries)) } catch { /* quota/private mode */ }
  }

  private push(event: PlaybackObservationEvent): void {
    this.events.push(event)
    if (this.events.length > MAX_SESSION_EVENTS) this.events.splice(0, this.events.length - MAX_SESSION_EVENTS)
  }

  begin(context: SourceOutcomeContext, automatic = false): PlaybackObservation | null {
    if (!this.canObserve()) return null
    const at = this.now()
    const contexts = contextHierarchy(context)
    const keys = contexts.map(contextKey)
    const attempt: PlaybackObservation = {
      id: ++this.sequence,
      context,
      contextKey: keys[0],
      contexts,
      contextKeys: keys,
      automatic,
      startedAt: at,
      stage: 'selected',
      seen: new Set(['selected']),
      terminal: false,
    }
    contexts.forEach((variant, index) => {
      const key = keys[index]
      const summary = this.load()[key] ?? blank(variant, at)
      materialize(summary, at)
      const counts = automatic ? summary.automatic : summary.manual
      counts.attempts++
      summary.lastAt = at
      this.load()[key] = summary
    })
    this.push({ attemptId: attempt.id, at, stage: 'selected', contextKey: keys[0], automatic })
    this.save()
    return attempt
  }

  mark(attempt: PlaybackObservation | null, stage: PlaybackObservationStage): void {
    if (!attempt || attempt.terminal || attempt.seen.has(stage)) return
    if (!this.canObserve()) { attempt.terminal = true; return }
    const at = this.now()
    const stableImpliesStartup = stage === 'stable' && !attempt.seen.has('first-frame')
    attempt.stage = stage
    attempt.seen.add(stage)
    // Some player backends can omit the intermediate first-frame event. Stable forward playback
    // is conclusive startup evidence, so retain that implication without inventing a latency.
    if (stableImpliesStartup) attempt.seen.add('first-frame')
    attempt.contexts.forEach((variant, index) => {
      const key = attempt.contextKeys[index]
      const summary = this.load()[key] ?? blank(variant, at)
      materialize(summary, at)
      const counts = attempt.automatic ? summary.automatic : summary.manual
      if (stage === 'resolved') {
        counts.resolveMs = latencyEstimate(counts.resolveMs, counts.resolveSamples, at - attempt.startedAt)
        counts.resolveSamples++
      } else if (stage === 'first-frame') {
        counts.firstFrameMs = latencyEstimate(counts.firstFrameMs, counts.firstFrameSamples, at - attempt.startedAt)
        counts.firstFrameSamples++
        counts.startupSuccesses++
      } else if (stage === 'stable') {
        if (stableImpliesStartup) counts.startupSuccesses++
        counts.stableSuccesses++
      }
      summary.lastAt = at
      this.load()[key] = summary
    })
    if (stage === 'stable') attempt.stableAt = at
    else if (stage === 'completed') attempt.terminal = true
    this.push({ attemptId: attempt.id, at, stage, contextKey: attempt.contextKey, automatic: attempt.automatic })
    this.save()
  }

  fail(attempt: PlaybackObservation | null, failureClass: PlaybackFailureClass, failedAt = attempt?.stage): void {
    if (!attempt || attempt.terminal) return
    if (!this.canObserve()) { attempt.terminal = true; return }
    const at = this.now()
    attempt.terminal = true
    attempt.contexts.forEach((variant, index) => {
      const key = attempt.contextKeys[index]
      const summary = this.load()[key] ?? blank(variant, at)
      materialize(summary, at)
      const counts = attempt.automatic ? summary.automatic : summary.manual
      if (attempt.seen.has('first-frame')) {
        counts.playbackFailures++
        // `stable` is useful intermediate feedback, but a later failure is the terminal sustained
        // outcome. Remove only this attempt's time-decayed credit so one play remains one trial.
        if (attempt.stableAt != null) {
          const credit = 0.5 ** (Math.max(0, at - attempt.stableAt) / OUTCOME_HALF_LIFE_MS)
          counts.stableSuccesses = Math.max(0, counts.stableSuccesses - credit)
        }
      } else {
        counts.startupFailures++
      }
      counts.failureClasses[failureClass] = (counts.failureClasses[failureClass] ?? 0) + 1
      summary.lastAt = at
      this.load()[key] = summary
    })
    this.push({
      attemptId: attempt.id,
      at,
      stage: 'failed',
      contextKey: attempt.contextKey,
      automatic: attempt.automatic,
      failureClass,
      failedAt,
    })
    this.save()
  }

  cancel(attempt: PlaybackObservation | null): void {
    if (!attempt || attempt.terminal) return
    if (!this.canObserve()) { attempt.terminal = true; return }
    const at = this.now()
    attempt.terminal = true
    attempt.contexts.forEach((variant, index) => {
      const key = attempt.contextKeys[index]
      const summary = this.load()[key] ?? blank(variant, at)
      materialize(summary, at)
      const counts = attempt.automatic ? summary.automatic : summary.manual
      counts.cancellations++
      summary.lastAt = at
      this.load()[key] = summary
    })
    this.push({ attemptId: attempt.id, at, stage: 'canceled', contextKey: attempt.contextKey, automatic: attempt.automatic })
    this.save()
  }

  summary(context: SourceOutcomeContext): SourceOutcomeSummary | undefined {
    const found = this.load()[contextKey(context)]
    return found ? projected(found, this.now()) : undefined
  }

  allSummaries(): SourceOutcomeSummary[] {
    const at = this.now()
    return Object.values(this.load()).map((summary) => projected(summary, at)).sort((a, b) => b.lastAt - a.lastAt)
  }

  sessionEvents(): readonly PlaybackObservationEvent[] {
    return this.events
  }

  clearSession(): void {
    this.events = []
  }

  clear(): void {
    this.summaries = {}
    this.events = []
    try { this.storage?.removeItem(STORAGE_KEY) } catch { /* ignore */ }
    for (const stale of LEGACY_STORAGE_KEYS) {
      try { this.storage?.removeItem(stale) } catch { /* ignore */ }
    }
  }
}

function browserStorage(): OutcomeStorage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage } catch { return undefined }
}

const journal = new SourceOutcomeJournal(
  {
    getItem: (key) => browserStorage()?.getItem(key) ?? null,
    setItem: (key, value) => browserStorage()?.setItem(key, value),
    removeItem: (key) => browserStorage()?.removeItem(key),
  },
  () => !get(incognito) && get(saveLocalHistory),
)

// Entering incognito immediately removes the diagnostic ring. Aggregate data from earlier normal
// sessions remains, like ordinary history; no incognito attempt can read/write it through wrappers.
incognito.subscribe((active) => { if (active) journal.clearSession() })

export function sourceOutcomeContext(
  stream: Stream,
  transport: PlaybackTransport,
): SourceOutcomeContext {
  let host = ''
  try { host = stream.url ? new URL(stream.url).hostname.toLowerCase() : '' } catch { /* opaque URL */ }
  const server = stream.__server?.trim().toLowerCase() || host
  const info = describe(stream)
  const size = info.sizeBytes == null ? ''
    : info.sizeBytes < 600 * 1024 ** 2 ? 'small'
      : info.sizeBytes < 2 * 1024 ** 3 ? 'medium'
        : info.sizeBytes < 8 * 1024 ** 3 ? 'large'
          : 'archive'
  const readiness = stream.__torrentUrl ? 'torrent-file'
    : stream.infoHash ? 'hash-only'
      : stream.__manifest ?? (stream.__drm ? 'drm' : stream.url ? 'http' : '')
  const releaseGroup = stream.__evidence?.releaseGroup ?? info.group
  const profile = [releaseGroup?.trim().toLowerCase() ?? '', readiness, size].filter(Boolean).join('|')
  const resolver = transport === 'debrid' ? get(debridProvider).trim().toLowerCase() : ''
  return {
    family: stream.__origin?.kind ?? (stream.__stream ? 'online-extension' : stream.infoHash ? 'torrent' : 'direct'),
    sourceId: stream.__origin?.id ?? 'unknown',
    transport,
    serverId: server ? `srv-${digest(server)}` : undefined,
    serviceId: resolver ? `svc-${digest(resolver)}` : undefined,
    profileId: profile ? `prf-${digest(profile)}` : undefined,
    language: stream.__lang?.trim().toLowerCase() || undefined,
  }
}

export function classifyPlaybackFailure(message: unknown): PlaybackFailureClass {
  const text = String(message ?? '').toLowerCase()
  if (/wrong short|wrong (?:episode|season|video)|different production|premature|ended before/.test(text)) return 'wrong-content'
  if (/dmca|copyright|content (?:filter|blocked)|infringement/.test(text)) return 'policy'
  if (/geo|country|region|not available in your location/.test(text)) return 'geo'
  if (/\b(?:401|403)\b|unauthori[sz]ed|forbidden|api.?key|token|log.?in|credential/.test(text)) return 'auth'
  if (/no streams?|no sources?|no playable|not found to (?:play|download)/.test(text)) return 'no-results'
  if (/unsupported|cannot play|not web ready/.test(text)) return 'unsupported'
  if (/metadata|info.?hash|magnet|torrent file/.test(text)) return 'metadata'
  if (/debrid|resolver|unrestrict|cache service/.test(text)) return 'resolver'
  if (/stall|buffer|too slow|failed to start|no peers?|no seeders?|network|timed? ?out|timeout/.test(text)) return 'stalled'
  if (/player|mpv|decode|codec|load error|demux/.test(text)) return 'player'
  if (/http|fetch|connection|socket|cdn/.test(text)) return 'transport'
  return 'unknown'
}

const observedStreams = new WeakMap<Stream, PlaybackObservation>()

export const beginSourceObservation = (stream: Stream, transport: PlaybackTransport, automatic = false) => {
  const attempt = journal.begin(sourceOutcomeContext(stream, transport), automatic)
  if (attempt) observedStreams.set(stream, attempt)
  return attempt
}
export const markSourceObservation = (attempt: PlaybackObservation | null, stage: PlaybackObservationStage) => journal.mark(attempt, stage)
export const failSourceObservation = (attempt: PlaybackObservation | null, message: unknown, failureClass = classifyPlaybackFailure(message)) => journal.fail(attempt, failureClass)
export const failObservedSource = (stream: Stream, message: unknown, failureClass = classifyPlaybackFailure(message)) =>
  journal.fail(observedStreams.get(stream) ?? null, failureClass)
export const cancelSourceObservation = (attempt: PlaybackObservation | null) => journal.cancel(attempt)
export function effectiveOutcomeTrials(summary: SourceOutcomeSummary): number {
  const trials = (counts: SourceOutcomeCounts) => counts.startupSuccesses + counts.startupFailures
  return trials(summary.automatic) + trials(summary.manual) * MANUAL_OUTCOME_WEIGHT
}

export const sourceOutcomeSummary = (stream: Stream, transport: PlaybackTransport) => {
  if (get(incognito) || !get(saveLocalHistory)) return undefined
  const context = sourceOutcomeContext(stream, transport)
  const detailed = journal.summary(context)
  // A profile/server arm has to earn enough of its own evidence before replacing its provider
  // prior. Until then, share the broader provider+transport experience instead of treating every
  // unseen release group as a cold start.
  if (detailed && effectiveOutcomeTrials(detailed) >= 4) return detailed
  return journal.summary(baseContext(context)) ?? detailed
}
export const sourceOutcomeEvents = () => journal.sessionEvents()
export const forgetSourceOutcomes = () => journal.clear()
