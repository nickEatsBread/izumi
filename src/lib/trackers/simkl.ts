import { simklFetch } from './simkl-auth'
import { classifyStatus, type PushResult, type TrackerOp } from './queue'
import { getIndex, lookupAnilistByMal } from '$lib/stremio/idmap'

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
    return response.ok
      ? { ok: true }
      : { ok: false, retryable: classifyStatus(response.status) === 'retry' }
  } catch { return { ok: false, retryable: true } }
}

export async function pushSimkl(op: TrackerOp): Promise<PushResult> {
  const animeIds = ids(op)
  if (op.kind === 'remove') return post('/sync/history/remove', { anime: [{ ids: animeIds }] })
  if (op.kind === 'score') {
    const rating = simklScore(op.score ?? 0)
    return rating === 0
      ? post('/sync/ratings/remove', { anime: [{ ids: animeIds }] })
      : post('/sync/ratings', { anime: [{ rating, ids: animeIds }] })
  }
  if (op.kind === 'progress') {
    const progress = Math.max(0, Math.round(op.progress ?? 0))
    if (progress > 0) {
      const history = await post('/sync/history', {
        anime: [{ ids: animeIds, episodes: Array.from({ length: progress }, (_, index) => ({ number: index + 1 })) }],
      })
      if (!history.ok) return history
    }
  }
  return post('/sync/add-to-list', { anime: [{ to: simklStatus(op.status), ids: animeIds }] })
}

interface SimklListItem {
  status?: string
  watched_episodes_count?: number
  user_rating?: number
  anime?: { ids?: { anilist?: number; mal?: number } }
  ids?: { anilist?: number; mal?: number }
}

let listCache: { at: number; entries: SimklListItem[] } | null = null
let listPending: Promise<SimklListItem[] | null> | null = null
async function listEntries(): Promise<SimklListItem[] | null> {
  if (listCache && Date.now() - listCache.at < 60_000) return listCache.entries
  if (listPending) return listPending
  const pending = (async () => {
    const response = await simklFetch('/sync/all-items/anime')
    if (!response?.ok) return null
    const json = await response.json() as { anime?: SimklListItem[] } | SimklListItem[]
    const entries = Array.isArray(json) ? json : json.anime ?? []
    listCache = { at: Date.now(), entries }
    return entries
  })()
  listPending = pending
  pending.finally(() => { if (listPending === pending) listPending = null })
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
      const itemIds = item.anime?.ids ?? item.ids
      return itemIds?.anilist === mediaId || (!!idMal && itemIds?.mal === idMal)
    })
    if (!entry) return null
    return {
      progress: entry.watched_episodes_count ?? 0,
      status: entry.status ?? '',
      score: (entry.user_rating ?? 0) * 10,
    }
  } catch { return null }
}

export function invalidateSimklList() { listCache = null }

/** Canonical AniList ids from one Simkl anime-library status. */
export async function getSimklAnimeIds(status: string, limit = 30): Promise<number[]> {
  const entries = await listEntries()
  if (!entries) return []
  const matching = entries.filter((entry) => entry.status === status)
  const direct = matching.flatMap((entry) => {
    const anilistId = Number((entry.anime?.ids ?? entry.ids)?.anilist)
    return Number.isFinite(anilistId) && anilistId > 0 ? [anilistId] : []
  })
  const unresolved = matching.filter((entry) => {
    const anilistId = Number((entry.anime?.ids ?? entry.ids)?.anilist)
    return !Number.isFinite(anilistId) || anilistId <= 0
  })
  const fallback: number[] = []
  if (unresolved.length) {
    const index = await getIndex()
    for (const entry of unresolved) {
      const malId = Number((entry.anime?.ids ?? entry.ids)?.mal)
      const mapped = Number.isFinite(malId) ? lookupAnilistByMal(index, malId) : undefined
      if (mapped != null) fallback.push(mapped)
    }
  }
  return [...direct, ...fallback].slice(0, Math.max(1, Math.round(limit)))
}
