import { derived, get, writable, type Readable } from 'svelte/store'
import { persisted } from 'svelte-persisted-store'
import type { Client } from '@urql/svelte'
import { LIST_QUERY, MEDIA_BY_IDS_QUERY, flattenEntries } from '$lib/anilist/lists'
import { getMalAnimeListMediaOrThrow, setStatus } from '$lib/trackers'
import { cwDismissAction } from '$lib/settings/ui'
import { hasAiredEpisodeToWatch } from '$lib/anilist/media'
import { localHistory, durableHistory, sessionProgress, historyEntries, mediaSnapshot, type HistoryEntry } from './history'
import { incognito, onIncognitoPurge } from '$lib/stores/incognito'
import type { Media } from '$lib/anilist/types'

// Local-first "Continue Watching": the row paints instantly from an on-device copy, then AniList/MAL
// reconcile in the background. `cwSnapshot` is a VIEW CACHE — the last merged list — deliberately
// separate from `localHistory` (the strict "played in this app" log that feeds MAL export + the
// schedule). See docs/superpowers/specs/2026-07-17-local-first-continue-watching-design.md.

export const CAP = 60 // bound the persisted list so localStorage can't grow without limit

export interface CwEntry {
  media: Media        // trimmed snapshot (mediaSnapshot() shape)
  progress: number    // watched-episode count, maxed across sources
  updatedAt: number   // ms epoch, recency ordering
  source: 'tracker' | 'local'
}

/** Persisted view cache of the last merged Continue Watching list. NOT localHistory. */
export const cwSnapshot = persisted<CwEntry[]>('cw-snapshot', [])

/** Series the user removed from Continue Watching, keyed to the watched-episode count AT removal.
 *  mergeInstant hides an entry whose progress is <= its dismissed floor, so the removal survives a
 *  tracker reconcile — yet the series reappears automatically once a NEWER episode is watched
 *  (progress exceeds the floor). No manual "un-dismiss" needed. */
export const cwDismissed = persisted<Record<number, number>>('cw-dismissed', {})

/** Session-only dismissals made while incognito. Kept out of the persisted `cwDismissed` for two
 *  reasons: the media id itself shouldn't be recorded, and an incognito progress floor would
 *  wrongly hide the show from normal-mode Continue Watching after the session ends. */
export const incognitoDismissed = writable<Record<number, number>>({})
onIncognitoPurge(() => incognitoDismissed.set({}))

/** True while a background reconcile is in flight (drives the grayed-out "provisional" cue). */
export const reconciling = writable(false)

/** Flips true after the first reconcile of the session, so only the initial paint-from-disk grays. */
export const reconciledOnce = writable(false)

// Local history contributes a resume-aware progress: `episode - 1` covers an episode that was OPENED
// but not finished (resume lands on it), while `progress` is the completed count. Take the larger.
const localProgress = (h: HistoryEntry) => Math.max(h.progress, h.episode - 1)

function upsert(map: Map<number, CwEntry>, e: CwEntry) {
  const cur = map.get(e.media.id)
  if (!cur) { map.set(e.media.id, { ...e }); return }
  cur.progress = Math.max(cur.progress, e.progress)
  cur.updatedAt = Math.max(cur.updatedAt, e.updatedAt)
  // Keep the media already in the map: snapshot entries are inserted first and carry the
  // reconciled (fresher) media, so we prefer them over a stale local snapshot on collision.
}

/**
 * PURE. The instant list: merge the persisted snapshot with live local history, dedupe by media id
 * (max progress, prefer the snapshot's reconciled media), fold in this session's freshly-watched
 * counts, hide caught-up shows, and order most-recent first. Runs synchronously — no network.
 */
export function mergeInstant(
  snapshot: CwEntry[],
  history: Record<number, HistoryEntry>,
  session: Record<number, number>,
  dismissed: Record<number, number> = {},
): CwEntry[] {
  const map = new Map<number, CwEntry>()
  for (const e of snapshot) upsert(map, e)
  for (const h of historyEntries(history)) {
    upsert(map, { media: h.media, progress: localProgress(h), updatedAt: h.updatedAt, source: 'local' })
  }
  for (const e of map.values()) {
    const s = session[e.media.id]
    if (s != null && s > e.progress) e.progress = s
  }
  return [...map.values()]
    // When a releasing title's cached/MAL projection has no schedule, the last episode actually
    // opened is valid evidence but `progress + 1` is not. Fresh metadata reconciles moments later.
    .filter((e) => hasAiredEpisodeToWatch(e.media, e.progress, history[e.media.id]?.episode))
    // Hide user-dismissed series until a NEWER episode is watched (progress passes the floor).
    .filter((e) => { const d = dismissed[e.media.id]; return d == null || e.progress > d })
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Renders instantly from the local snapshot ∪ history (minus dismissals); recomputes as any store changes. */
export const continueWatching: Readable<CwEntry[]> = derived(
  [cwSnapshot, localHistory, sessionProgress, cwDismissed, incognitoDismissed],
  ([$snapshot, $history, $session, $dismissed, $incognitoDismissed]) =>
    mergeInstant($snapshot, $history, $session, { ...$dismissed, ...$incognitoDismissed }),
)

/** Remove a series from Continue Watching. Records a dismissed floor (survives reconcile, self-heals
 *  on a new watch) and applies the configured tracker side-effect (none / On Hold / Dropped).
 *  In incognito the floor is session-only and the tracker side-effect is suppressed upstream. */
export function dismissContinueWatching(media: Media, progress: number): void {
  const target = get(incognito) ? incognitoDismissed : cwDismissed
  target.update((d) => ({ ...d, [media.id]: progress }))
  const action = get(cwDismissAction)
  if (action === 'dropped') void setStatus(media, 'DROPPED')
  else if (action === 'paused') void setStatus(media, 'PAUSED')
}

// ── Reconcile ────────────────────────────────────────────────────────────────────────────────────

interface Item { media: Media; progress: number; updatedAt: number }

export interface BuildInput {
  ani: Item[]
  mal: Item[]
  refreshedMedia: Record<number, Media> // fresh airing info for local-history ids
  history: Record<number, HistoryEntry>
  session: Record<number, number>
  prior: CwEntry[]                       // previous snapshot — feeds the only-increase floor, NOT membership
}

/**
 * PURE. Rebuild the persisted snapshot from freshly-fetched sources.
 *  - Membership = ani ∪ mal ∪ localHistory (a show dropped from the tracker AND not played here falls out).
 *  - Only-increase: progress = max(source, priorSnapshot, localHistory, session) so a stale/slow remote
 *    read never regresses a freshly-watched count, while a higher remote (watched elsewhere) is adopted.
 *  - Media prefers the freshest fetched record; stored trimmed via mediaSnapshot().
 * Caught-up shows are KEPT here (render-time filtering lets them reappear when a new episode airs).
 */
export function buildSnapshot(inp: BuildInput): CwEntry[] {
  const priorProgress = new Map(inp.prior.map((e) => [e.media.id, e.progress]))
  const map = new Map<number, CwEntry>()

  const add = (media: Media, progress: number, updatedAt: number, source: 'tracker' | 'local') => {
    const id = media.id
    const fresh = inp.refreshedMedia[id] ?? media
    const floor = Math.max(
      progress,
      priorProgress.get(id) ?? 0,
      inp.history[id]?.progress ?? 0,
      inp.session[id] ?? 0,
    )
    const cur = map.get(id)
    if (!cur) {
      map.set(id, { media: mediaSnapshot(fresh), progress: floor, updatedAt, source })
    } else {
      cur.progress = Math.max(cur.progress, floor)
      cur.updatedAt = Math.max(cur.updatedAt, updatedAt)
      if (inp.refreshedMedia[id]) cur.media = mediaSnapshot(fresh) // adopt the refreshed airing info
    }
  }

  for (const e of inp.ani) add(e.media, e.progress, e.updatedAt, 'tracker')
  for (const e of inp.mal) add(e.media, e.progress, e.updatedAt, 'tracker')
  for (const h of historyEntries(inp.history)) add(h.media, localProgress(h), h.updatedAt, 'local')

  return [...map.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, CAP)
}

// Just the query surface of the urql client — enough to run the reads, and a full Client (or a test
// fake cast to it) satisfies it.
type QueryClient = Pick<Client, 'query'>

// urql defaults to cache-first and the normalized cache lives as long as the client (i.e. the whole
// process, barring an account switch). Without a policy the list read below was served from memory
// after the first reconcile of a session, which made RECONCILE_TTL_MS and `reconciling` decorative
// and meant progress watched on another device, or a removal from the list, never showed up until
// relaunch. cache-and-network keeps the instant cache emission for anything subscribing live, and
// `.toPromise()` drops that emission as stale — so what we await here, and therefore what lands in
// the snapshot, is the network read. Only the LIST read gets this: it is the one thing that goes
// stale in a way the user can notice mid-session.
const LIST_REVALIDATE = { requestPolicy: 'cache-and-network' } as const

// The compact metadata refresh below fetches titles, covers and airing state. It is capped to the
// row's own maximum and uses ContinueMediaFields; leaving it cache-first avoids fanning expensive
// full MediaFields requests over a user's lifetime history on every home mount.
const MEDIA_DEFAULT = {} as const

async function fetchAni(client: QueryClient, userName: string | undefined): Promise<{ items: Item[]; failed: boolean }> {
  if (!userName) return { items: [], failed: false }
  try {
    const res = await client.query(LIST_QUERY, { userName, status: 'CURRENT' }, LIST_REVALIDATE).toPromise()
    if (res.error) return { items: [], failed: true }
    const items = flattenEntries(res.data as never).map((e) => ({
      media: e.media,
      progress: e.progress ?? e.media.mediaListEntry?.progress ?? 0,
      updatedAt: (e.updatedAt ?? 0) * 1000,
    }))
    return { items, failed: false }
  }
  catch { return { items: [], failed: true } }
}

async function fetchMal(malActive: boolean): Promise<{ items: Item[]; failed: boolean }> {
  if (!malActive) return { items: [], failed: false }
  try {
    const list = await getMalAnimeListMediaOrThrow('watching', CAP)
    const items = list.map((entry) => ({
      media: entry.media,
      progress: entry.progress,
      updatedAt: entry.updatedAt,
    }))
    return { items, failed: false }
  }
  catch { return { items: [], failed: true } }
}

async function refreshContinueMedia(
  client: QueryClient,
  malItems: Item[],
): Promise<{ media: Record<number, Media>; failed: boolean }> {
  // MAL's embedded list cards know the planned episode total but not the airing schedule. Refresh
  // those canonical AniList ids alongside local-history cards; otherwise RELEASING rows have an
  // unknown aired count and Continue Watching can invent progress + 1 before it airs. Keep only the
  // CAP most-recent candidates because buildSnapshot applies that same final bound.
  const candidates = new Map<number, number>()
  for (const item of malItems) candidates.set(item.media.id, item.updatedAt)
  for (const item of historyEntries(get(durableHistory))) {
    candidates.set(item.media.id, Math.max(candidates.get(item.media.id) ?? 0, item.updatedAt))
  }
  const ids = [...candidates]
    .sort((left, right) => right[1] - left[1])
    .slice(0, CAP)
    .map(([id]) => id)
  if (!ids.length) return { media: {}, failed: false }
  try {
    const media: Record<number, Media> = {}
    for (let i = 0; i < ids.length; i += 50) {
      const res = await client.query(MEDIA_BY_IDS_QUERY, { ids: ids.slice(i, i + 50) }, MEDIA_DEFAULT).toPromise()
      if (res.error) return { media: {}, failed: true }
      for (const m of (res.data as { Page?: { media?: Media[] } })?.Page?.media ?? []) media[m.id] = m
    }
    return { media, failed: false }
  }
  catch { return { media: {}, failed: true } }
}

// Throttle + de-dupe the background reconcile. ContinueRow runs it on every mount, so bouncing
// home↔detail refired the full 3-call tracker sync each time — needless load against AniList's
// tight rate budget when the local-first snapshot already painted. Skip if one finished within the
// TTL, and fold concurrent callers onto the in-flight run. `force` (used by tests + any caller that
// genuinely needs fresh data) bypasses both guards.
const RECONCILE_TTL_MS = 45_000
let lastReconciledAt = 0
let reconcileInFlight: Promise<void> | null = null

/**
 * Background sync: fetch the trackers + refresh local media, then rebuild `cwSnapshot`. Best-effort —
 * never throws. If an ENABLED tracker fetch failed (offline), the write is skipped so a good snapshot
 * isn't clobbered to empty. Local-only users (no linked tracker) need no network and return early.
 */
export async function reconcileContinueWatching(client: QueryClient, userName: string | undefined, malActive: boolean, force = false): Promise<void> {
  if (!userName && !malActive) { reconciledOnce.set(true); return }
  if (!force) {
    if (reconcileInFlight) return reconcileInFlight
    if (Date.now() - lastReconciledAt < RECONCILE_TTL_MS) return
  }
  const run = (async () => {
    reconciling.set(true)
    try {
      const [ani, mal] = await Promise.all([
        fetchAni(client, userName),
        fetchMal(malActive),
      ])
      const enabledTrackerFailed = (!!userName && ani.failed) || (malActive && mal.failed)
      if (enabledTrackerFailed) return // keep the snapshot; can't tell "removed" from "unreachable"
      const refreshed = await refreshContinueMedia(client, mal.items)
      // durableHistory, NOT localHistory: the snapshot is persisted, so an incognito overlay entry
      // must never be baked into it (sessionProgress is likewise never written by incognito plays).
      cwSnapshot.set(buildSnapshot({
        ani: ani.items,
        mal: mal.items,
        refreshedMedia: refreshed.media,
        history: get(durableHistory),
        session: get(sessionProgress),
        prior: get(cwSnapshot),
      }))
    }
    finally {
      lastReconciledAt = Date.now()
      reconciledOnce.set(true)
      reconciling.set(false)
      reconcileInFlight = null
    }
  })()
  reconcileInFlight = run
  return run
}
