import { persisted } from 'svelte-persisted-store'
import { get } from 'svelte/store'
import { anilistToken, malToken } from './config'
import type { AniStatus } from './index'
import type { FuzzyDate } from '$lib/anilist/types'

// Durable retry queue for tracker writes. Live pushes (progress/status/score) are best-effort;
// when a push HARD-fails (offline, 5xx, network) instead of losing it forever we enqueue it here and
// replay on reconnect / next boot / after any later successful push. 429s are NOT queued — the
// AniList client already backs those off internally. Permanent failures (bad token, no idMal) are
// dropped, not retried.
//
// Cycle-avoidance: this module owns the store + policy only. The actual mutation/HTTP replay lives
// in index.ts and is injected via registerReplay() at its module load — so queue.ts never imports
// index.ts at runtime (only the AniStatus TYPE, which is erased). index.ts → queue.ts is one-way.

export type TrackerName = 'AniList' | 'MAL'
export type OpKind = 'progress' | 'status' | 'score' | 'remove'

// Extra list-entry fields that ride along with a progress push (start/finish dates, rewatch count).
export interface ProgressExtras {
  startedAt?: FuzzyDate
  completedAt?: FuzzyDate
  repeat?: number
  isRewatching?: boolean
}

// One tracker write, normalized so both the live path and a replay build the same request.
export interface TrackerOp {
  kind: OpKind
  mediaId: number
  idMal?: number
  listEntryId?: number // AniList mediaList entry id — required to DELETE the entry (kind 'remove')
  progress?: number
  status?: AniStatus
  score?: number // 0-100 (canonical); mapped per-tracker at push time
  extras?: ProgressExtras
}

export type PushResult = { ok: true } | { ok: false; retryable: boolean }

interface QueueEntry {
  tracker: TrackerName
  op: TrackerOp
  attempts: number
  createdAt: number
  updatedAt: number
  nextAttemptAt: number
}

/** Pending tracker writes awaiting a successful replay. */
export const trackerQueue = persisted<QueueEntry[]>('tracker-queue', [])
/** The highest progress CONFIRMED delivered per `${tracker}:${mediaId}` — the only-increase floor
 *  (a queued lower progress is dropped rather than rewinding the tracker). */
const confirmedProgress = persisted<Record<string, number>>('tracker-progress-confirmed', {})

const BASE_BACKOFF = 30_000
const MAX_BACKOFF = 6 * 3_600_000
const MAX_ATTEMPTS = 12
const MAX_AGE = 14 * 24 * 3_600_000
const MAX_ENTRIES = 500

const progKey = (t: TrackerName, mediaId: number) => `${t}:${mediaId}`
const opKey = (t: TrackerName, op: TrackerOp) => `${t}:${op.mediaId}:${op.kind}`
const backoffMs = (attempts: number) => Math.min(BASE_BACKOFF * 2 ** attempts, MAX_BACKOFF)

/** The confirmed progress floor for a title on a tracker (0 if none delivered yet). */
export function confirmedFloor(t: TrackerName, mediaId: number): number {
  return get(confirmedProgress)[progKey(t, mediaId)] ?? 0
}
/** Record that `progress` was successfully delivered to a tracker — raises the only-increase floor. */
export function markConfirmed(t: TrackerName, mediaId: number, progress: number) {
  confirmedProgress.update((m) => {
    const k = progKey(t, mediaId)
    return progress > (m[k] ?? 0) ? { ...m, [k]: progress } : m
  })
}

/** Classify an HTTP status into retryable (transient — keep) vs permanent (drop). */
export function classifyStatus(status: number): 'retry' | 'drop' {
  if (status === 408 || status === 429 || status >= 500) return 'retry'
  if (status === 400 || status === 401 || status === 403 || status === 404) return 'drop'
  return 'retry' // unknown → keep rather than silently lose the update
}

// The replay fn, injected by index.ts (which owns the GraphQL/HTTP). null until registered.
let replay: ((op: TrackerOp, tracker: TrackerName) => Promise<PushResult>) | null = null
export function registerReplay(fn: (op: TrackerOp, tracker: TrackerName) => Promise<PushResult>) { replay = fn }

/** Enqueue a failed op, coalescing so the queue never grows unbounded or replays stale state:
 *  - progress: keep only the LATEST/HIGHEST per title (never replays ep3 then ep5), skip entirely
 *    when it wouldn't advance the confirmed floor, and evict a pending status op for the same title
 *    so a stale bookmark can't clobber the resumed status.
 *  - status / score: one pending entry per title, newest wins. */
export function enqueue(tracker: TrackerName, op: TrackerOp) {
  const now = ownNow()
  trackerQueue.update((q) => {
    let next = q
    if (op.kind === 'progress') {
      const p = op.progress ?? 0
      // The only-increase floor guards normal forward progress; a REPEATING (rewatch) pass
      // legitimately re-walks lower episodes, so it is exempt (else it'd be dropped as "stale").
      if (op.status !== 'REPEATING' && p <= confirmedFloor(tracker, op.mediaId)) return next // already delivered a >= progress
      // Merge with an existing pending progress op for this title (keep the higher progress + newest
      // status/extras), and drop any pending status op (progress carries the authoritative status).
      // EXCEPT across a rewatch boundary: a REPEATING op merging with a pending non-REPEATING op
      // (or vice versa) must not inherit the other pass's episode count — a rewatch starting at ep1
      // absorbing a stale queued ep12 would replay "REPEATING at ep12" and finish the rewatch
      // instantly. The newer op reflects the newer intent; it wins outright.
      const existing = next.find((e) => e.tracker === tracker && opKey(tracker, e.op) === opKey(tracker, op))
      const sameWatchPass = existing && (existing.op.status === 'REPEATING') === (op.status === 'REPEATING')
      const merged: TrackerOp = existing && sameWatchPass && (existing.op.progress ?? 0) > p
        ? { ...op, progress: existing.op.progress }
        : op
      next = next.filter((e) => !(e.tracker === tracker && (e.op.kind === 'progress' || e.op.kind === 'status' || e.op.kind === 'remove') && e.op.mediaId === op.mediaId))
      next = [...next, entry(tracker, merged, existing, now)]
    } else if (op.kind === 'remove') {
      // A delete supersedes every other pending op for the title — no point replaying a write then
      // deleting the entry.
      const existing = next.find((e) => e.tracker === tracker && opKey(tracker, e.op) === opKey(tracker, op))
      next = next.filter((e) => !(e.tracker === tracker && e.op.mediaId === op.mediaId))
      next = [...next, entry(tracker, op, existing, now)]
    } else {
      const existing = next.find((e) => e.tracker === tracker && opKey(tracker, e.op) === opKey(tracker, op))
      // Drop the same-kind op it replaces, plus any pending delete for the title (a re-add cancels it).
      next = next.filter((e) => !(e.tracker === tracker && (opKey(tracker, e.op) === opKey(tracker, op) || (e.op.kind === 'remove' && e.op.mediaId === op.mediaId))))
      next = [...next, entry(tracker, op, existing, now)]
    }
    // Hard cap: evict the oldest-touched entries if we somehow blow past the ceiling.
    if (next.length > MAX_ENTRIES) next = [...next].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_ENTRIES)
    return next
  })
}

function entry(tracker: TrackerName, op: TrackerOp, prev: QueueEntry | undefined, now: number): QueueEntry {
  return { tracker, op, attempts: 0, createdAt: prev?.createdAt ?? now, updatedAt: now, nextAttemptAt: now }
}

let flushing = false
/** Replay every due entry once. Safe to call repeatedly (mutex + online guard). */
export async function flushQueue(): Promise<void> {
  if (flushing || !replay) return
  if (typeof navigator !== 'undefined' && !navigator.onLine) return
  flushing = true
  try {
    const now = ownNow()
    const due = get(trackerQueue).filter((e) => e.nextAttemptAt <= now && tokenReady(e.tracker))
    for (const e of due) {
      // Superseded progress (a later push already delivered >= this) → drop without replaying.
      // Rewatch (REPEATING) progress is exempt — its lower episode count is intentional.
      if (e.op.kind === 'progress' && e.op.status !== 'REPEATING' && (e.op.progress ?? 0) <= confirmedFloor(e.tracker, e.op.mediaId)) {
        remove(e); continue
      }
      let res: PushResult
      try { res = await replay(e.op, e.tracker) } catch { res = { ok: false, retryable: true } }
      if (res.ok) {
        if (e.op.kind === 'progress') markConfirmed(e.tracker, e.op.mediaId, e.op.progress ?? 0)
        remove(e)
      } else if (!res.retryable) {
        remove(e)
      } else {
        bump(e, now)
      }
      if (e.tracker === 'MAL') await sleep(350) // MAL has no client-side limiter — space replays
    }
  } finally {
    flushing = false
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function remove(target: QueueEntry) {
  trackerQueue.update((q) => q.filter((e) => e !== target))
}
function bump(target: QueueEntry, now: number) {
  trackerQueue.update((q) => q.flatMap((e) => {
    if (e !== target) return [e]
    const attempts = e.attempts + 1
    if (attempts >= MAX_ATTEMPTS || now - e.createdAt > MAX_AGE) return [] // give up
    return [{ ...e, attempts, updatedAt: now, nextAttemptAt: now + backoffMs(attempts) }]
  }))
}

function tokenReady(t: TrackerName): boolean {
  return t === 'AniList' ? !!get(anilistToken) : !!get(malToken)
}

// Date.now() is available at app runtime (the ban is workflow-scripts-only).
function ownNow(): number { return Date.now() }

let inited = false
/** Wire the online-reconnect flush + run one boot flush. Idempotent. */
export function initTrackerQueue() {
  if (inited || typeof window === 'undefined') return
  inited = true
  window.addEventListener('online', () => { void flushQueue() })
  void flushQueue()
}
