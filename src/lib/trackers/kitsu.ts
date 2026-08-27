import { get } from 'svelte/store'
import { getKitsuId } from '$lib/anizip'
import { getIndex, lookupAnilistByKitsu, lookupKitsu } from '$lib/stremio/idmap'
import { kitsuIdFromMal } from '$lib/stremio/kitsu'
import { kitsuToken, kitsuUserId } from './config'
import { kitsuFetch, refreshKitsuViewer } from './kitsu-auth'
import { classifyStatus, type PushResult, type TrackerOp } from './queue'

const API = 'https://kitsu.io/api/edge'
const JSON_API = { 'Content-Type': 'application/vnd.api+json' }

export function kitsuStatus(status = 'CURRENT'): string {
  return ({
    CURRENT: 'current', PLANNING: 'planned', COMPLETED: 'completed',
    PAUSED: 'on_hold', DROPPED: 'dropped', REPEATING: 'current',
  } as Record<string, string>)[status] ?? 'current'
}

export function kitsuScore(score0to100: number): number | null {
  if (score0to100 <= 0) return null
  return Math.max(2, Math.min(20, Math.round(score0to100 / 5)))
}

const pad2 = (value: number) => String(value).padStart(2, '0')
const kitsuDate = (date?: { year?: number | null; month?: number | null; day?: number | null }) =>
  date?.year && date.month && date.day ? `${date.year}-${pad2(date.month)}-${pad2(date.day)}` : undefined

export async function resolveKitsuId(op: TrackerOp): Promise<number | undefined> {
  if (op.idKitsu) return op.idKitsu
  const anilistId = op.idAniList ?? (op.mediaId > 0 ? op.mediaId : undefined)
  if (!anilistId) return await kitsuIdFromMal(op.idMal)
  try {
    const mapped = lookupKitsu(await getIndex(), anilistId)
    if (mapped) return mapped
  } catch { /* continue through smaller fallbacks */ }
  const anizip = await getKitsuId(anilistId).catch(() => undefined)
  return anizip ?? await kitsuIdFromMal(op.idMal)
}

interface LibraryEntry {
  id: string
  attributes?: {
    progress?: number
    status?: string
    ratingTwenty?: number | null
  }
  relationships?: { anime?: { data?: { id?: string } } }
}

async function findEntry(kitsuId: number): Promise<LibraryEntry | null | undefined> {
  let userId = get(kitsuUserId)
  if (!userId) {
    await refreshKitsuViewer()
    userId = get(kitsuUserId)
  }
  if (!userId) return undefined
  const url = `${API}/library-entries?filter%5BuserId%5D=${encodeURIComponent(userId)}&filter%5BanimeId%5D=${kitsuId}&page%5Blimit%5D=1`
  const response = await kitsuFetch(url)
  if (!response) return undefined
  if (!response.ok) throw Object.assign(new Error(`Kitsu library lookup failed (${response.status})`), { status: response.status })
  const json = await response.json() as { data?: LibraryEntry[] }
  return json.data?.[0] ?? null
}

function attributes(op: TrackerOp): Record<string, unknown> {
  if (op.kind === 'status') return { status: kitsuStatus(op.status) }
  if (op.kind === 'score') return { ratingTwenty: kitsuScore(op.score ?? 0) }
  const result: Record<string, unknown> = {
    progress: Math.max(0, Math.round(op.progress ?? 0)),
    status: kitsuStatus(op.status),
  }
  if (op.status === 'REPEATING' || op.extras?.isRewatching != null) {
    result.reconsuming = op.status === 'REPEATING' && op.extras?.isRewatching !== false
  }
  if (op.extras?.repeat != null) result.reconsumeCount = Math.max(0, Math.round(op.extras.repeat))
  const startedAt = kitsuDate(op.extras?.startedAt)
  const finishedAt = kitsuDate(op.extras?.completedAt)
  if (startedAt) result.startedAt = startedAt
  if (finishedAt) result.finishedAt = finishedAt
  return result
}

function resultForStatus(status: number): PushResult {
  return { ok: false, retryable: classifyStatus(status) === 'retry' }
}

export async function pushKitsu(op: TrackerOp): Promise<PushResult> {
  try {
    const kitsuId = await resolveKitsuId(op)
    if (!kitsuId) return { ok: false, retryable: false }
    const entry = await findEntry(kitsuId)
    if (entry === undefined) return { ok: false, retryable: false }
    if (op.kind === 'remove') {
      if (!entry) return { ok: true }
      const response = await kitsuFetch(`${API}/library-entries/${entry.id}`, { method: 'DELETE' })
      if (!response) return { ok: false, retryable: false }
      return response.ok || response.status === 404 ? { ok: true } : resultForStatus(response.status)
    }

    const data = entry
      ? { type: 'libraryEntries', id: entry.id, attributes: attributes(op) }
      : {
          type: 'libraryEntries',
          attributes: attributes(op),
          relationships: {
            user: { data: { type: 'users', id: get(kitsuUserId) } },
            anime: { data: { type: 'anime', id: String(kitsuId) } },
          },
        }
    const response = await kitsuFetch(entry ? `${API}/library-entries/${entry.id}` : `${API}/library-entries`, {
      method: entry ? 'PATCH' : 'POST',
      headers: JSON_API,
      body: JSON.stringify({ data }),
    })
    if (!response) return { ok: false, retryable: false }
    return response.ok ? { ok: true } : resultForStatus(response.status)
  } catch (error) {
    const status = (error as { status?: number }).status
    return typeof status === 'number' ? resultForStatus(status) : { ok: false, retryable: true }
  }
}

export interface KitsuProgress {
  progress: number
  status: string
  score: number
}

export async function getKitsuProgress(mediaId: number, idMal?: number): Promise<KitsuProgress | null> {
  if (!get(kitsuToken)) return null
  try {
    const kitsuId = await resolveKitsuId({ kind: 'progress', mediaId, idMal })
    if (!kitsuId) return null
    const entry = await findEntry(kitsuId)
    if (!entry) return null
    return {
      progress: entry.attributes?.progress ?? 0,
      status: entry.attributes?.status ?? '',
      score: (entry.attributes?.ratingTwenty ?? 0) * 5,
    }
  } catch { return null }
}

/** Canonical AniList ids from one Kitsu anime-library status, for schedule filters. */
export async function getKitsuAnimeIds(status: string, limit = 20): Promise<number[]> {
  if (!get(kitsuToken)) return []
  let userId = get(kitsuUserId)
  if (!userId) { await refreshKitsuViewer(); userId = get(kitsuUserId) }
  if (!userId) return []
  const capped = Math.max(1, Math.min(20, Math.round(limit)))
  const url = `${API}/library-entries?filter%5BuserId%5D=${encodeURIComponent(userId)}`
    + `&filter%5Bkind%5D=anime&filter%5Bstatus%5D=${encodeURIComponent(status)}`
    + `&sort=-updatedAt&page%5Blimit%5D=${capped}`
  const response = await kitsuFetch(url)
  if (!response?.ok) return []
  const json = await response.json() as { data?: LibraryEntry[] }
  const index = await getIndex()
  return (json.data ?? []).flatMap((entry) => {
    const kitsuId = Number(entry.relationships?.anime?.data?.id)
    const anilistId = Number.isFinite(kitsuId) ? lookupAnilistByKitsu(index, kitsuId) : undefined
    return anilistId == null ? [] : [anilistId]
  })
}
