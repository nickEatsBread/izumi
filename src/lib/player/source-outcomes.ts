import { get } from 'svelte/store'
import { saveLocalHistory } from '$lib/settings/ui'
import { incognito } from '$lib/stores/incognito'
import type { Stream } from '$lib/stremio/parse'

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
  language?: string
}

export interface SourceOutcomeSummary {
  context: SourceOutcomeContext
  attempts: number
  resolved: number
  firstFrames: number
  stable: number
  completed: number
  failures: number
  cancellations: number
  failureClasses: Partial<Record<PlaybackFailureClass, number>>
  resolveMs?: number
  firstFrameMs?: number
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
  readonly automatic: boolean
  readonly startedAt: number
  stage: PlaybackObservationStage
  seen: Set<PlaybackObservationStage>
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

const STORAGE_KEY = 'source-outcomes-v1'
const MAX_SUMMARIES = 128
const MAX_SESSION_EVENTS = 256

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
    context.language ?? '',
  ].join('|'))}`
}

function rolling(previous: number | undefined, sample: number): number {
  return Math.round(previous == null ? sample : previous * 0.7 + sample * 0.3)
}

function blank(context: SourceOutcomeContext, at: number): SourceOutcomeSummary {
  return {
    context,
    attempts: 0,
    resolved: 0,
    firstFrames: 0,
    stable: 0,
    completed: 0,
    failures: 0,
    cancellations: 0,
    failureClasses: {},
    lastAt: at,
  }
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
    const key = contextKey(context)
    const attempt: PlaybackObservation = {
      id: ++this.sequence,
      context,
      contextKey: key,
      automatic,
      startedAt: at,
      stage: 'selected',
      seen: new Set(['selected']),
      terminal: false,
    }
    const summary = this.load()[key] ?? blank(context, at)
    summary.attempts++
    summary.lastAt = at
    this.load()[key] = summary
    this.push({ attemptId: attempt.id, at, stage: 'selected', contextKey: key, automatic })
    this.save()
    return attempt
  }

  mark(attempt: PlaybackObservation | null, stage: PlaybackObservationStage): void {
    if (!attempt || attempt.terminal || attempt.seen.has(stage)) return
    if (!this.canObserve()) { attempt.terminal = true; return }
    const at = this.now()
    attempt.stage = stage
    attempt.seen.add(stage)
    const summary = this.load()[attempt.contextKey] ?? blank(attempt.context, at)
    if (stage === 'resolved') {
      summary.resolved++
      summary.resolveMs = rolling(summary.resolveMs, at - attempt.startedAt)
    } else if (stage === 'first-frame') {
      summary.firstFrames++
      summary.firstFrameMs = rolling(summary.firstFrameMs, at - attempt.startedAt)
    } else if (stage === 'stable') summary.stable++
    else if (stage === 'completed') { summary.completed++; attempt.terminal = true }
    summary.lastAt = at
    this.load()[attempt.contextKey] = summary
    this.push({ attemptId: attempt.id, at, stage, contextKey: attempt.contextKey, automatic: attempt.automatic })
    this.save()
  }

  fail(attempt: PlaybackObservation | null, failureClass: PlaybackFailureClass, failedAt = attempt?.stage): void {
    if (!attempt || attempt.terminal) return
    if (!this.canObserve()) { attempt.terminal = true; return }
    const at = this.now()
    attempt.terminal = true
    const summary = this.load()[attempt.contextKey] ?? blank(attempt.context, at)
    summary.failures++
    summary.failureClasses[failureClass] = (summary.failureClasses[failureClass] ?? 0) + 1
    summary.lastAt = at
    this.load()[attempt.contextKey] = summary
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
    const summary = this.load()[attempt.contextKey] ?? blank(attempt.context, at)
    summary.cancellations++
    summary.lastAt = at
    this.load()[attempt.contextKey] = summary
    this.push({ attemptId: attempt.id, at, stage: 'canceled', contextKey: attempt.contextKey, automatic: attempt.automatic })
    this.save()
  }

  summary(context: SourceOutcomeContext): SourceOutcomeSummary | undefined {
    return this.load()[contextKey(context)]
  }

  allSummaries(): SourceOutcomeSummary[] {
    return Object.values(this.load()).sort((a, b) => b.lastAt - a.lastAt)
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
  return {
    family: stream.__origin?.kind ?? (stream.__stream ? 'online-extension' : stream.infoHash ? 'torrent' : 'direct'),
    sourceId: stream.__origin?.id ?? 'unknown',
    transport,
    serverId: server ? `srv-${digest(server)}` : undefined,
    language: stream.__lang?.trim().toLowerCase() || undefined,
  }
}

export function classifyPlaybackFailure(message: unknown): PlaybackFailureClass {
  const text = String(message ?? '').toLowerCase()
  if (/wrong short|wrong (?:episode|season|video)|different production|premature/.test(text)) return 'wrong-content'
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
export const sourceOutcomeSummary = (stream: Stream, transport: PlaybackTransport) =>
  get(incognito) || !get(saveLocalHistory) ? undefined : journal.summary(sourceOutcomeContext(stream, transport))
export const sourceOutcomeEvents = () => journal.sessionEvents()
export const forgetSourceOutcomes = () => journal.clear()
