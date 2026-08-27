import { persisted } from 'svelte-persisted-store'
import { get, type Readable } from 'svelte/store'
import { anilistToken, kitsuToken, malToken, simklToken } from './config'
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

export type TrackerName = 'AniList' | 'MAL' | 'Kitsu' | 'Simkl'
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
  /** Provider-neutral local key used for queue dedupe/history. */
  mediaId: number
  idAniList?: number
  idMal?: number
  idKitsu?: number
  listEntryId?: number // AniList mediaList entry id — required to DELETE the entry (kind 'remove')
  progress?: number
  status?: AniStatus
  score?: number // 0-100 (canonical); mapped per-tracker at push time
  extras?: ProgressExtras
}

export type PushResult =
  | { ok: true; echoedProgress?: number }
  | { ok: false; retryable: boolean }

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

/** After a SUCCESSFUL live push, drop queued entries it supersedes for the same title:
 *  - a landed write (progress/status/score) cancels a pending 'remove' — else the replay would
 *    DELETE the entry the user just re-created;
 *  - a landed 'remove' cancels pending writes — they'd re-create a just-deleted entry.
 *  (enqueue() only coalesces on the FAILURE path; this handles the live-success path.) */
export function dropSuperseded(tracker: TrackerName, mediaId: number, justPushed: OpKind) {
  trackerQueue.update((q) => q.filter((e) => {
    if (e.tracker !== tracker || e.op.mediaId !== mediaId) return true
    return justPushed === 'remove' ? false : e.op.kind !== 'remove'
  }))
}

/** Classify an HTTP status into retryable (transient — keep) vs permanent (drop). */
export function classifyStatus(status: number): 'retry' | 'drop' {
  if (status === 408 || status === 429 || status >= 500) return 'retry'
  // Deterministic client/auth/conflict failures do not improve when replayed unchanged. SIMKL in
  // particular uses 412 for a missing/invalid/suspended client_id and documents it as non-retryable.
  if ([400, 401, 403, 404, 409, 412].includes(status)) return 'drop'
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
      if (e.tracker !== 'AniList') await sleep(350) // REST trackers have no shared client limiter
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
  if (t === 'AniList') return !!get(anilistToken)
  if (t === 'MAL') return !!get(malToken)
  if (t === 'Kitsu') return !!get(kitsuToken)
  return !!get(simklToken)
}

// Date.now() is available at app runtime (the ban is workflow-scripts-only).
function ownNow(): number { return Date.now() }

const WAKE_INTERVAL = 60_000

let inited = false
let teardown: (() => void) | null = null
/** Wire every flush trigger + run one boot flush. Idempotent — repeat calls return the SAME
 *  teardown rather than stacking a second interval/listener set. */
export function initTrackerQueue(): () => void {
  if (typeof window === 'undefined') return () => {}
  if (inited) return teardown ?? (() => {})
  inited = true
  const wake = () => { void flushQueue() }
  // 'online' + the boot flush alone leave the backoff ladder decorative: the resume paths that
  // actually matter — Deck suspend/resume, an Android warm start, a VPN flap — fire no 'online'
  // event, so an episode finished offline would sit unsynced until the next app launch. The
  // periodic wake is the only trigger that guarantees a queued op gets its next attempt at all;
  // it can't defeat the ladder because flushQueue only replays entries past nextAttemptAt.
  const timer = setInterval(wake, WAKE_INTERVAL)
  const onVisible = () => { if (document.visibilityState === 'visible') wake() }
  window.addEventListener('online', wake)
  window.addEventListener('focus', wake)
  document.addEventListener('visibilitychange', onVisible)
  // tokenReady() gates the replay, so ops queued while signed out (or while a MAL token was
  // cleared pending refresh) are skipped by every wake until auth lands. The token stores ARE the
  // readiness signal, so subscribing turns sign-in into a trigger instead of a wait for the next tick.
  const unsubs = [anilistToken, malToken, kitsuToken, simklToken].map((store) => watchToken(store, wake))
  teardown = () => {
    clearInterval(timer)
    window.removeEventListener('online', wake)
    window.removeEventListener('focus', wake)
    document.removeEventListener('visibilitychange', onVisible)
    for (const un of unsubs) un()
    inited = false
    teardown = null
  }
  void flushQueue()
  return teardown
}

/** Call `onReady` when a token store goes empty → set. subscribe() fires synchronously with the
 *  current value, so the first emission is the baseline, never a transition. */
function watchToken(store: Readable<string | null>, onReady: () => void): () => void {
  let had: boolean | null = null
  return store.subscribe((v) => {
    const has = !!v
    if (had === false && has) onReady()
    had = has
  })
}
