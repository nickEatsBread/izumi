import { get } from 'svelte/store'
import { anilist } from '$lib/anilist/client'
import { gql } from '@urql/core'
import { anilistToken, malToken, malUser, malClientId } from './config'
import { malFetch } from './mal-auth'
import { malHttpFetch } from './mal-http'
import { recordProgress, localHistory } from '$lib/player/history'
import {
  enqueue, markConfirmed, confirmedFloor, flushQueue, registerReplay, classifyStatus,
  type TrackerOp, type TrackerName, type PushResult, type ProgressExtras,
} from './queue'
import type { Media, FuzzyDate } from '$lib/anilist/types'

export type AniStatus = 'CURRENT' | 'PLANNING' | 'COMPLETED' | 'PAUSED' | 'DROPPED' | 'REPEATING'
export function malStatus(s: AniStatus): string {
  return ({ CURRENT: 'watching', PLANNING: 'plan_to_watch', COMPLETED: 'completed', PAUSED: 'on_hold', DROPPED: 'dropped', REPEATING: 'watching' } as const)[s]
}
export type { ProgressExtras }

// SaveMediaListEntry carries progress + status + the optional start/finish dates and rewatch count.
// AniList treats an OMITTED variable as "leave unchanged" (urql/JSON.stringify drops undefined), so
// unset extras are never written — never pass null (that would CLEAR the field).
const SAVE = gql`mutation ($mediaId: Int, $status: MediaListStatus, $progress: Int, $repeat: Int, $startedAt: FuzzyDateInput, $completedAt: FuzzyDateInput) {
  SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress, repeat: $repeat, startedAt: $startedAt, completedAt: $completedAt) { id progress status }
}`

const SET_STATUS = gql`mutation ($mediaId: Int, $status: MediaListStatus) {
  SaveMediaListEntry(mediaId: $mediaId, status: $status) { id status }
}`

// scoreRaw is ALWAYS 0-100, independent of the viewer's chosen score format — so no format lookup
// is needed. scoreRaw:0 clears the rating.
const SAVE_SCORE = gql`mutation ($mediaId: Int, $scoreRaw: Int) {
  SaveMediaListEntry(mediaId: $mediaId, scoreRaw: $scoreRaw) { id score }
}`

const TOGGLE_FAVOURITE = gql`mutation ($animeId: Int) {
  ToggleFavourite(animeId: $animeId) { anime { nodes { id } } }
}`

// Delete the viewer's list entry entirely. Takes the mediaList ENTRY id (mediaListEntry.id), NOT
// the media id. A 404 (already gone) is treated as permanent-drop by the queue, which is correct.
const DELETE_ENTRY = gql`mutation ($id: Int) {
  DeleteMediaListEntry(id: $id) { deleted }
}`

const MAL_LIST = (idMal: number) => `https://api.myanimelist.net/v2/anime/${idMal}/my_list_status`
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' }

// ── Score mapping (canonical 0-100) ────────────────────────────────────────────
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)))
/** 0-100 → AniList scoreRaw (0-100). */
export const aniScore = (score0to100: number) => clamp(score0to100, 0, 100)
/** 0-100 → MAL score (0-10). */
export const malScore = (score0to100: number) => clamp(score0to100 / 10, 0, 10)

// ── Fuzzy dates ────────────────────────────────────────────────────────────────
const pad2 = (n: number) => String(n).padStart(2, '0')
/** Today as an AniList FuzzyDate (app runtime may use new Date(); the ban is workflow-scripts-only). */
function fuzzyToday(): FuzzyDate {
  const d = new Date()
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }
}
/** FuzzyDate → MAL "YYYY-MM-DD", or null when incomplete. */
function fuzzyToMal(d?: FuzzyDate | null): string | null {
  return d?.year && d.month && d.day ? `${d.year}-${pad2(d.month)}-${pad2(d.day)}` : null
}
const hasFullFuzzy = (d?: FuzzyDate | null) => !!(d?.year && d?.month && d?.day)

// ── Low-level per-tracker pushes (shared by the live path AND the queue replay) ──
// urql's .toPromise() RESOLVES on failure (the error is on result.error), so success must be
// detected via the ABSENCE of result.error — a try/catch alone would mis-report every failure as OK.
function aniClassify(error: { networkError?: unknown; response?: unknown }): PushResult {
  if (error.networkError) return { ok: false, retryable: true } // fetch/invoke threw → offline/DNS
  const status = (error.response as { status?: number } | undefined)?.status
  if (typeof status === 'number') return { ok: false, retryable: classifyStatus(status) === 'retry' }
  return { ok: false, retryable: false } // GraphQL-level error with no transient HTTP status → permanent
}

async function pushAniList(op: TrackerOp): Promise<PushResult> {
  try {
    let r
    if (op.kind === 'progress') {
      r = await anilist.mutation(SAVE, {
        mediaId: op.mediaId, progress: op.progress, status: op.status,
        repeat: op.extras?.repeat, startedAt: op.extras?.startedAt, completedAt: op.extras?.completedAt,
      }).toPromise()
    } else if (op.kind === 'status') {
      r = await anilist.mutation(SET_STATUS, { mediaId: op.mediaId, status: op.status }).toPromise()
    } else if (op.kind === 'remove') {
      if (!op.listEntryId) return { ok: false, retryable: false } // no AniList entry to delete
      r = await anilist.mutation(DELETE_ENTRY, { id: op.listEntryId }).toPromise()
    } else {
      r = await anilist.mutation(SAVE_SCORE, { mediaId: op.mediaId, scoreRaw: aniScore(op.score ?? 0) }).toPromise()
    }
    if (!r.error) return { ok: true }
    return aniClassify(r.error)
  } catch { return { ok: false, retryable: true } }
}

function malBody(op: TrackerOp): string {
  const p = new URLSearchParams()
  if (op.kind === 'progress') {
    p.set('status', malStatus(op.status ?? 'CURRENT'))
    p.set('num_watched_episodes', String(op.progress ?? 0))
    const e = op.extras
    if (e) {
      const sd = fuzzyToMal(e.startedAt); if (sd) p.set('start_date', sd)
      const fd = fuzzyToMal(e.completedAt); if (fd) p.set('finish_date', fd)
      if (e.repeat != null) p.set('num_times_rewatched', String(e.repeat))
      if (e.isRewatching != null) p.set('is_rewatching', String(e.isRewatching))
    }
  } else if (op.kind === 'status') {
    p.set('status', malStatus(op.status ?? 'CURRENT'))
  } else {
    p.set('score', String(malScore(op.score ?? 0)))
  }
  return p.toString()
}

async function pushMal(op: TrackerOp): Promise<PushResult> {
  if (!op.idMal) return { ok: false, retryable: false } // can't address MAL without idMal
  try {
    const init: RequestInit = op.kind === 'remove'
      ? { method: 'DELETE' }
      : { method: 'PATCH', headers: FORM, body: malBody(op) }
    const r = await malFetch(MAL_LIST(op.idMal), init)
    if (!r) return { ok: false, retryable: false } // no token → not connected
    if (r.ok) return { ok: true }
    // malFetch already refreshed-and-retried once on 401, so a 401 here is a dead token (permanent).
    return { ok: false, retryable: classifyStatus(r.status) === 'retry' }
  } catch { return { ok: false, retryable: true } }
}

// Replay a queued op against its tracker. Registered with the queue at module load (the queue owns
// the store + retry policy; the mutation/HTTP details stay here).
function replayEntry(op: TrackerOp, tracker: TrackerName): Promise<PushResult> {
  return tracker === 'AniList' ? pushAniList(op) : pushMal(op)
}
registerReplay(replayEntry)

// Run one op against each connected tracker, enqueuing on a transient failure and confirming the
// progress floor on success. Best-effort; never throws. Returns which trackers took it live.
async function push(media: Media, op: Omit<TrackerOp, 'mediaId' | 'idMal'>): Promise<string[]> {
  const results: string[] = []
  const idMal = media.idMal ?? undefined
  const prog = op.kind === 'progress' ? op.progress ?? 0 : undefined
  if (get(anilistToken)) {
    const aop: TrackerOp = { ...op, mediaId: media.id }
    const r = await pushAniList(aop)
    if (r.ok) { results.push('AniList'); if (prog != null) markConfirmed('AniList', media.id, prog) }
    else if (r.retryable) enqueue('AniList', aop)
  }
  if (get(malToken) && idMal) {
    const mop: TrackerOp = { ...op, mediaId: media.id, idMal }
    const r = await pushMal(mop)
    if (r.ok) { results.push('MAL'); if (prog != null) markConfirmed('MAL', media.id, prog) }
    else if (r.retryable) enqueue('MAL', mop)
  }
  if (results.length) void flushQueue() // connectivity just confirmed → drain any backlog
  return results
}

// Push progress+status (and optional start/finish dates + rewatch count) to every connected tracker.
export function updateProgress(media: Media, progress: number, status: AniStatus = 'CURRENT', extras: ProgressExtras = {}): Promise<string[]> {
  return push(media, { kind: 'progress', progress, status, extras })
}

// Mark an episode WATCHED across local history + every connected tracker, with the guards the raw
// push lacks:
//   #1 only-increase — re-watching an EARLIER episode must not push the tracker backwards (skip the
//      remote push; local history still maxes). A RE-WATCH of an already-finished show legitimately
//      re-walks earlier episodes, so it bypasses this guard.
//   #2 complete-on-finish — the last episode sets COMPLETED, not CURRENT.
//   #6 dates + REPEATING — stamp startedAt on the first episode, completedAt on completion; a watch
//      of an already-complete show becomes a REPEATING pass (AniList status REPEATING + repeat++,
//      MAL is_rewatching + num_times_rewatched).
// Returns the pre-bump known count (the Android undo toast needs it).
export function markWatched(media: Media, episode: number): number {
  const entry = media.mediaListEntry
  const known = Math.max(entry?.progress ?? 0, get(localHistory)[media.id]?.progress ?? 0)
  recordProgress(media, episode) // local — always, independent of any linked tracker
  const finished = media.episodes != null && episode >= media.episodes
  // Already-complete = COMPLETED status OR the known count has reached the (known) total. The count
  // fallback is load-bearing for Continue-Watching plays whose media snapshot omits mediaListEntry.
  const alreadyComplete = entry?.status === 'COMPLETED' || (media.episodes != null && known >= media.episodes)
  const rewatch = alreadyComplete || entry?.status === 'REPEATING'
  // #1: behind the known count and not a rewatch/finale → the local bump is enough.
  if (!rewatch && episode <= known && !finished) return known

  const status: AniStatus = finished ? 'COMPLETED' : (rewatch ? 'REPEATING' : 'CURRENT')
  const extras: ProgressExtras = {}
  const today = fuzzyToday()
  // First-ever watch → stamp a start date (unless the entry already carries one).
  if (!rewatch && known === 0 && episode >= 1 && !hasFullFuzzy(entry?.startedAt)) extras.startedAt = today
  // Entering a fresh rewatch pass (was COMPLETED, not yet REPEATING) → stamp a new start date.
  else if (rewatch && entry?.status !== 'REPEATING') extras.startedAt = today
  if (finished) {
    if (rewatch) { extras.completedAt = today; extras.repeat = (entry?.repeat ?? 0) + 1 }
    else if (!hasFullFuzzy(entry?.completedAt)) extras.completedAt = today // first finish
  }
  if (rewatch) extras.isRewatching = !finished // MAL: flag stays on until the pass completes

  updateProgress(media, episode, status, extras).then((t) => t.length && console.log('tracked on', t.join(', '))).catch(() => {})
  return known
}

// Set the list status (e.g. PLANNING to bookmark) on every connected tracker. Best-effort.
export function setStatus(media: Media, status: AniStatus): Promise<string[]> {
  return push(media, { kind: 'status', status })
}

// Set the viewer's rating (canonical 0-100) on every connected tracker. Best-effort. score 0 clears.
export function setScore(media: Media, score0to100: number): Promise<string[]> {
  return push(media, { kind: 'score', score: score0to100 })
}

// Remove the title from the viewer's list entirely (AniList DeleteMediaListEntry by entry id + MAL
// DELETE my_list_status). Best-effort; the AniList delete no-ops when we don't have the entry id
// (e.g. MAL-only). Pass the media whose mediaListEntry.id was fetched by the detail query.
export function removeFromList(media: Media): Promise<string[]> {
  return push(media, { kind: 'remove', listEntryId: media.mediaListEntry?.id })
}

// Toggle the AniList favourite flag for a title (AniList only; MAL has no
// favourite endpoint). Requires an AniList token. Throws on failure so the UI
// can surface it / not flip its optimistic state.
export async function toggleFavourite(media: Media) {
  if (!get(anilistToken)) throw new Error('AniList not connected')
  await anilist.mutation(TOGGLE_FAVOURITE, { animeId: media.id }).toPromise()
}

// Read the viewer's watched-episode count + list status + score FROM MAL (v2 API). We already push to
// MAL in `updateProgress`; this is the read-back so progress/rating show even when the user tracks on
// MAL rather than AniList (AniList's `mediaListEntry` is null then). score is MAL 0-10 (0 = unrated).
// Returns null if MAL isn't connected, there's no idMal, the token is stale, or the title isn't listed.
export async function getMalProgress(idMal?: number): Promise<{ progress: number; status: string; score: number } | null> {
  if (!get(malToken) || !idMal) return null
  try {
    const r = await malFetch(`https://api.myanimelist.net/v2/anime/${idMal}?fields=my_list_status`)
    if (!r?.ok) return null
    const j = await r.json() as { my_list_status?: { num_episodes_watched?: number; status?: string; score?: number } }
    const s = j.my_list_status
    if (!s) return null
    return { progress: s.num_episodes_watched ?? 0, status: s.status ?? '', score: s.score ?? 0 }
  }
  catch { return null }
}

// One MAL animelist row (shared shape of the OAuth @me and public-username endpoints — MAL
// returns identical JSON for both).
interface MalListNode { node?: { id?: number }; list_status?: { num_episodes_watched?: number; updated_at?: string } }

// Fetch a MAL anime list for `status`, most-recently-updated first. Prefers the signed-in
// viewer (OAuth @me); falls back to the PUBLIC list of a read-only `malUser` username, which
// MAL's official API serves with just the app's X-MAL-CLIENT-ID header (no token). Returns
// null when neither is configured; throws on an HTTP error so callers can tell "offline/error"
// from "genuinely empty".
async function fetchMalListRaw(status: string, limit: number): Promise<MalListNode[] | null> {
  const q = `animelist?status=${status}&sort=list_updated_at&limit=${limit}&fields=list_status`
  if (get(malToken)) {
    const r = await malFetch(`https://api.myanimelist.net/v2/users/@me/${q}`)
    if (!r) return null
    if (!r.ok) throw new Error(`MyAnimeList list request failed (${r.status})`)
    return ((await r.json()) as { data?: MalListNode[] }).data ?? []
  }
  const user = get(malUser)
  if (user && malClientId) {
    const r = await malHttpFetch(`https://api.myanimelist.net/v2/users/${encodeURIComponent(user)}/${q}`, {
      headers: { 'X-MAL-CLIENT-ID': malClientId },
    })
    if (!r.ok) throw new Error(`MyAnimeList list request failed (${r.status})`)
    return ((await r.json()) as { data?: MalListNode[] }).data ?? []
  }
  return null
}

// Fetch the viewer's MAL anime-list ids for a status (e.g. 'watching',
// 'plan_to_watch'), most-recently-updated first, so the home rows can show the
// MAL library for MAL-primary users. Returns [] if MAL isn't connected/set. Map these
// ids to AniList media via MEDIA_BY_MAL_QUERY to render cards.
export async function getMalAnimeIdsOrThrow(status: string, limit = 20): Promise<number[]> {
  const data = await fetchMalListRaw(status, limit)
  if (!data) return []
  return data.map((d) => d.node?.id).filter((n): n is number => typeof n === 'number')
}

export async function getMalAnimeIds(status: string, limit = 20): Promise<number[]> {
  try { return await getMalAnimeIdsOrThrow(status, limit) }
  catch { return [] }
}

// Like getMalAnimeIds, but keeps the canonical watched-episode count that the list
// endpoint already returns (fields=list_status) — one request, no per-title lookups.
// Used by the resume row so MAL-tracked shows resume at the right episode. Most-recent
// first. `updatedAt` is the entry's edit time in ms (Continue Watching orders by it).
export interface MalListEntry { idMal: number; progress: number; updatedAt: number }

// Throwing variant: rejects on an HTTP failure so callers that must distinguish "offline/error"
// from "genuinely empty list" (Continue Watching's no-clobber guard) can catch it. Returns [] only
// when MAL isn't connected or the list is truly empty.
export async function getMalListProgressOrThrow(status: string, limit = 20): Promise<MalListEntry[]> {
  const data = await fetchMalListRaw(status, limit)
  if (!data) return []
  return data
    .map((d) => ({
      idMal: d.node?.id,
      progress: d.list_status?.num_episodes_watched ?? 0,
      updatedAt: d.list_status?.updated_at ? Date.parse(d.list_status.updated_at) : 0,
    }))
    .filter((e): e is MalListEntry => typeof e.idMal === 'number')
}

// Non-throwing wrapper: swallows errors to [] for callers that treat an empty list the same as a
// failure (the original resume-row behaviour).
export async function getMalListProgress(status: string, limit = 20): Promise<MalListEntry[]> {
  try { return await getMalListProgressOrThrow(status, limit) }
  catch { return [] }
}

export const anyTrackerConnected = () => !!(get(anilistToken) || get(malToken))

// Re-exported so callers can check the confirmed-progress floor without importing the queue directly.
export { confirmedFloor }
