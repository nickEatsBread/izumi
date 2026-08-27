import { simklFetch } from './simkl-auth'
import { classifyStatus, type PushResult, type TrackerOp } from './queue'
import { getIndex, lookupAnilistByMal } from '$lib/stremio/idmap'
import { simklToken } from './config'
import { persisted } from 'svelte-persisted-store'
import { get } from 'svelte/store'

export function simklStatus(status = 'CURRENT'): string {
  return ({
    CURRENT: 'watching', PLANNING: 'plantowatch', COMPLETED: 'completed',
    PAUSED: 'hold', DROPPED: 'dropped', REPEATING: 'watching',
  } as Record<string, string>)[status] ?? 'watching'
}

export const simklScore = (score0to100: number) => Math.max(0, Math.min(10, Math.round(score0to100 / 10)))

function ids(op: TrackerOp): Record<string, number> {
  const anilist = op.idAniList ?? (op.mediaId > 0 ? op.mediaId : undefined)
  return {
    ...(anilist ? { anilist } : {}),
    ...(op.idMal ? { mal: op.idMal } : {}),
  }
}

async function post(path: string, body: unknown): Promise<PushResult> {
  try {
    const response = await simklFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response) return { ok: false, retryable: false }
    if (response.ok) return { ok: true }
    // A second sync write can occasionally meet SIMKL's per-user sync lock even though Izumi
    // serializes requests. This is the one documented 400 that should be retried unchanged.
    const error = response.status === 400
      ? (await response.clone().json().catch(() => ({})) as { error?: unknown }).error
      : undefined
    return { ok: false, retryable: error === 'rate_limit' || classifyStatus(response.status) === 'retry' }
  } catch { return { ok: false, retryable: true } }
}

export async function pushSimkl(op: TrackerOp): Promise<PushResult> {
  const animeIds = ids(op)
  // SIMKL's removal endpoint silently ignores a top-level anime[] array; anime titles must use
  // shows[] there even though the corresponding add endpoint accepts either spelling.
  if (op.kind === 'remove') return post('/sync/history/remove', { shows: [{ ids: animeIds }] })
  if (op.kind === 'score') {
    const rating = simklScore(op.score ?? 0)
    return rating === 0
      ? post('/sync/ratings/remove', { anime: [{ ids: animeIds }] })
      : post('/sync/ratings', { anime: [{ rating, ids: animeIds }] })
  }
  if (op.kind === 'progress') {
    const progress = Math.max(0, Math.round(op.progress ?? 0))
    if (progress > 0) {
      // History accepts the target status on the same item and already moves the watchlist row.
      // Chaining add-to-list would be redundant and would consume a second scarce POST slot.
      return post('/sync/history', {
        anime: [{
          ids: animeIds,
          status: simklStatus(op.status),
          episodes: Array.from({ length: progress }, (_, index) => ({ number: index + 1 })),
        }],
      })
    }
  }
  return post('/sync/add-to-list', { anime: [{ to: simklStatus(op.status), ids: animeIds }] })
}

interface SimklListItem {
  status?: string
  watched_episodes_count?: number
  user_rating?: number
  anime?: { ids?: SimklIds }
  // GET /sync/all-items/anime currently returns the standard anime/show object here. SIMKL
  // documents anime as sharing the Show shape and supporting both wrapper names across endpoints.
  show?: { ids?: SimklIds }
  ids?: SimklIds
}

interface SimklIds {
  simkl?: number
  simkl_id?: number
  slug?: string
  // SIMKL documents every external response ID as a string, even when it is numeric-looking.
  anilist?: string | number
  mal?: string | number
}

interface SimklAnimeCache {
  activityAll?: string
  removedFromList?: string
  entries: SimklListItem[]
}

// Keep the initial anime-list baseline across launches. SIMKL explicitly asks clients to perform
// one full pull, then gate later reads through /sync/activities instead of downloading the whole
// watchlist every time the app starts or a detail page opens.
const storedListCache = persisted<SimklAnimeCache | null>('simkl-anime-list-cache-v1', null)
let listCache = get(storedListCache)
let listCheckedAt = 0
let listPending: Promise<SimklListItem[] | null> | null = null
let cacheGeneration = 0
const ACTIVITY_CHECK_TTL_MS = 15 * 60 * 1_000

interface SimklAnimeActivity {
  all?: string
  removedFromList?: string
}

async function currentAnimeActivity(): Promise<SimklAnimeActivity | null> {
  try {
    const response = await simklFetch('/sync/activities')
    if (!response?.ok) return null
    const json = await response.json().catch(() => ({})) as {
      anime?: { all?: unknown; removed_from_list?: unknown }
    }
    return {
      all: typeof json.anime?.all === 'string' ? json.anime.all : undefined,
      removedFromList: typeof json.anime?.removed_from_list === 'string'
        ? json.anime.removed_from_list
        : undefined,
    }
  } catch { return null }
}

async function fetchAnimeItems(path: string): Promise<SimklListItem[] | null> {
  const response = await simklFetch(path)
  if (!response) return null
  if (!response.ok) throw new Error(`Simkl returned HTTP ${response.status}.`)
  const json = await response.json().catch(() => null) as { anime?: SimklListItem[] } | SimklListItem[] | null
  if (!json) throw new Error('Simkl returned an unreadable library response.')
  return Array.isArray(json) ? json : json.anime ?? []
}

function itemIds(item: SimklListItem): SimklIds {
  return item.anime?.ids ?? item.show?.ids ?? item.ids ?? {}
}

function itemKey(item: SimklListItem): string | undefined {
  const value = itemIds(item)
  const simkl = value.simkl ?? value.simkl_id
  if (simkl) return `simkl:${simkl}`
  if (value.anilist) return `anilist:${value.anilist}`
  if (value.mal) return `mal:${value.mal}`
  return undefined
}

function mergeItems(current: SimklListItem[], delta: SimklListItem[]): SimklListItem[] {
  const merged = new Map<string, SimklListItem>()
  const unkeyed: SimklListItem[] = []
  for (const item of [...current, ...delta]) {
    const key = itemKey(item)
    if (key) merged.set(key, item)
    else unkeyed.push(item)
  }
  return [...merged.values(), ...unkeyed]
}

async function listEntries(): Promise<SimklListItem[] | null> {
  if (listCache && Date.now() - listCheckedAt < ACTIVITY_CHECK_TTL_MS) return listCache.entries
  if (listPending) return listPending
  const generation = cacheGeneration
  const pending = (async () => {
    if (listCache?.activityAll) {
      const activity = await currentAnimeActivity()
      if (generation !== cacheGeneration) return null
      listCheckedAt = Date.now()
      // A failed activity check should not trigger a large full-library request. Keep the last
      // known-good baseline and try the cheap check again on the next user-visible refresh.
      if (!activity?.all || activity.all === listCache.activityAll) return listCache.entries

      const deltaPath = `/sync/all-items/anime?date_from=${encodeURIComponent(listCache.activityAll)}`
      const delta = await fetchAnimeItems(deltaPath)
      if (generation !== cacheGeneration || !delta) return listCache.entries
      let entries = mergeItems(listCache.entries, delta)

      // date_from does not include removals. SIMKL recommends a cheap ID-only snapshot when the
      // deletion timestamp moves, then diffing it against the local cache.
      if (activity.removedFromList && activity.removedFromList !== listCache.removedFromList) {
        const currentIds = await fetchAnimeItems('/sync/all-items/anime?extended=simkl_ids_only')
        if (generation !== cacheGeneration || !currentIds) return listCache.entries
        const retained = new Set(currentIds.map(itemKey).filter((key): key is string => Boolean(key)))
        entries = entries.filter((entry) => {
          const key = itemKey(entry)
          return !key || retained.has(key)
        })
      }

      listCache = {
        activityAll: activity.all,
        removedFromList: activity.removedFromList,
        entries,
      }
      storedListCache.set(listCache)
      return entries
    }

    const entries = await fetchAnimeItems('/sync/all-items/anime')
    if (generation !== cacheGeneration) return null
    if (!entries) return listCache?.entries ?? null
    // The initial sync baseline is the activity timestamp fetched immediately after the full pull.
    const activity = await currentAnimeActivity()
    if (generation !== cacheGeneration) return null
    listCache = {
      activityAll: activity?.all,
      removedFromList: activity?.removedFromList,
      entries,
    }
    storedListCache.set(listCache)
    listCheckedAt = Date.now()
    return entries
  })()
  listPending = pending
  pending.then(
    () => { if (listPending === pending) listPending = null },
    () => { if (listPending === pending) listPending = null },
  )
  return pending
}

export interface SimklProgress {
  progress: number
  status: string
  score: number
}

export async function getSimklProgress(mediaId: number, idMal?: number): Promise<SimklProgress | null> {
  try {
    const entries = await listEntries()
    const entry = entries?.find((item) => {
      const values = itemIds(item)
      return Number(values.anilist) === mediaId || (!!idMal && Number(values.mal) === idMal)
    })
    if (!entry) return null
    return {
      progress: entry.watched_episodes_count ?? 0,
      status: entry.status ?? '',
      score: (entry.user_rating ?? 0) * 10,
    }
  } catch { return null }
}

export function invalidateSimklList() {
  cacheGeneration += 1
  listCheckedAt = 0
  listPending = null
}

export function clearSimklListCache() {
  cacheGeneration += 1
  listCache = null
  storedListCache.set(null)
  listCheckedAt = 0
  listPending = null
}

// Never show one connected account the previous account's durable list baseline.
let observedToken = get(simklToken)
simklToken.subscribe((token) => {
  if (token !== observedToken) clearSimklListCache()
  observedToken = token
})

/** Canonical AniList ids from one Simkl anime-library status. */
export async function getSimklAnimeIds(status: string, limit = 30): Promise<number[]> {
  return (await getSimklAnimeRefs(status, limit)).map((item) => item.anilistId)
}

export interface SimklAnimeRef {
  anilistId: number
  simklUrl?: string
}

/** AniList ids for rendering plus the mandatory per-title Simkl attribution target. */
export async function getSimklAnimeRefs(status: string, limit = 30): Promise<SimklAnimeRef[]> {
  const entries = await listEntries()
  if (!entries) return []
  const matching = entries.filter((entry) => entry.status === status)
  const index = matching.some((entry) => !itemIds(entry).anilist) ? await getIndex() : null
  const refs: SimklAnimeRef[] = []
  for (const entry of matching) {
    const values = itemIds(entry)
    const direct = Number(values.anilist)
    const mal = Number(values.mal)
    const anilistId = Number.isFinite(direct) && direct > 0
      ? direct
      : Number.isFinite(mal) && index ? lookupAnilistByMal(index, mal) : undefined
    if (anilistId == null) continue
    const simkl = Number(values.simkl ?? values.simkl_id)
    const slug = typeof values.slug === 'string' ? values.slug.trim() : ''
    refs.push({
      anilistId,
      simklUrl: Number.isFinite(simkl) && simkl > 0
        ? `https://simkl.com/anime/${simkl}/${encodeURIComponent(slug)}`
        : undefined,
    })
    if (refs.length >= Math.max(1, Math.round(limit))) break
  }
  return refs
}
