import * as publicEnv from '$env/static/public'
import { phttp } from '$lib/net/http'
import type { Media } from '$lib/anilist/types'
import type { DiscussionThread } from './types'

const API_BASE = 'https://discussanime.moe/api/v1'
const REQUEST_TIMEOUT_MS = 5_000
const MAX_RESPONSE_BYTES = 512 * 1024
const RATE_LIMIT_COOLDOWN_MS = 60_000
const API_KEY_PATTERN = /^dak_[a-f\d]{32}$/i

export interface DiscussAnimeThread {
  id: number
  slug: string
  title: string
  url: string
  mal_id: number | null
  episode_number: number | null
  episode_number_end: number | null
  comment_count: number
  created_at: number
}

interface ThreadsResponse {
  threads?: unknown
  has_more?: boolean
  page?: number
}

let cooldownUntil = 0
let warnedMissingKey = false

export function discussAnimeThreadsUrl(
  media: Pick<Media, 'id' | 'format'> & { idMal?: number | null },
  episode: number | null | undefined,
) {
  const url = new URL(`${API_BASE}/threads`)
  if (media.idMal) url.searchParams.set('mal_id', String(media.idMal))
  else url.searchParams.set('anilist_id', String(media.id))
  if (media.format !== 'MOVIE' && Number.isInteger(episode) && Number(episode) > 0) {
    url.searchParams.set('episode', String(episode))
    url.searchParams.set('episode_window', '30')
  }
  url.searchParams.set('limit', '100')
  url.searchParams.set('page', '1')
  return url.toString()
}

function isThread(value: unknown): value is DiscussAnimeThread {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<DiscussAnimeThread>
  return typeof row.id === 'number' && Number.isInteger(row.id)
    && typeof row.slug === 'string'
    && typeof row.title === 'string'
    && typeof row.url === 'string'
    && typeof row.comment_count === 'number' && Number.isFinite(row.comment_count)
    && typeof row.created_at === 'number' && Number.isFinite(row.created_at)
}

export function matchDiscussAnimeThread(
  rows: DiscussAnimeThread[],
  episode: number | null | undefined,
  isMovie: boolean,
) {
  if (isMovie) return rows.find((row) => row.episode_number == null) ?? rows[0] ?? null
  if (!Number.isInteger(episode) || Number(episode) <= 0) {
    return rows.find((row) => row.episode_number == null) ?? null
  }
  const target = Number(episode)
  const exact = rows.find((row) => {
    if (row.episode_number == null) return false
    const end = row.episode_number_end ?? row.episode_number
    return row.episode_number <= target && end >= target
  })
  if (exact) return exact

  // Preserve the old mapper's nearest-previous fallback for combined/final episode threads.
  return rows
    .filter((row) => row.episode_number != null && row.episode_number <= target)
    .sort((a, b) => (b.episode_number ?? 0) - (a.episode_number ?? 0))[0] ?? null
}

export function discussAnimeEmbedUrl(row: DiscussAnimeThread) {
  const url = new URL('https://disqus.com/embed/comments/')
  url.searchParams.set('base', 'default')
  url.searchParams.set('f', 'discussanime')
  url.searchParams.set('t_i', `thread-${row.id}`)
  url.searchParams.set('t_u', row.url)
  url.searchParams.set('t_e', row.title)
  url.searchParams.set('t_t', row.title)
  url.searchParams.set('s_o', 'default')
  return url.toString()
}

/** The v1 API no longer carries the legacy `is_embed`/`embed_url` fields, but migrated
 * forum threads have a stable `archive-` slug and are still served by DiscussAnime's own
 * archive renderer. Live threads continue to use Disqus so sign-in and replies work. */
export function isArchivedDiscussAnimeThread(row: Pick<DiscussAnimeThread, 'slug'>) {
  return row.slug.toLowerCase().startsWith('archive-')
}

export function discussAnimeArchiveEmbedUrl(row: Pick<DiscussAnimeThread, 'slug'>) {
  return `https://discussanime.moe/embed/discussion/${encodeURIComponent(row.slug)}`
}

export function mapDiscussAnimeThread(row: DiscussAnimeThread): DiscussionThread {
  const archived = isArchivedDiscussAnimeThread(row)
  return {
    id: `${archived ? 'discussanime-archive' : 'disqus-thread'}-${row.id}`,
    source: 'Disqus',
    title: row.title,
    url: row.url,
    replyCount: row.comment_count,
    createdAt: row.created_at * 1000,
    embedUrl: archived ? discussAnimeArchiveEmbedUrl(row) : discussAnimeEmbedUrl(row),
  }
}

/** Resolve the official Discuss Anime thread directly; failures never hold up other sources. */
export async function fetchDiscussAnimeThread(
  media: Media,
  episode: number | null | undefined,
): Promise<DiscussionThread[]> {
  // Tauri ships an adapter-static client with no server runtime from which `$env/dynamic/public`
  // could populate values. Bake this public application key into each platform bundle at build
  // time; the release workflow already supplies it to every build job.
  // Namespace access keeps local/preview builds valid when the optional public key is absent;
  // release builds still bake it in through their platform-specific build environment.
  const key = (publicEnv as Record<string, string | undefined>).PUBLIC_DISCUSS_ANIME_API_KEY?.trim()
  if (!key || !API_KEY_PATTERN.test(key)) {
    if (!warnedMissingKey) {
      warnedMissingKey = true
      console.warn('[izumi comments] PUBLIC_DISCUSS_ANIME_API_KEY is missing or invalid; Disqus is disabled')
    }
    return []
  }
  if (Date.now() < cooldownUntil) return []

  try {
    const response = await phttp(discussAnimeThreadsUrl(media, episode), {
      headers: { 'X-API-Key': key },
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxBytes: MAX_RESPONSE_BYTES,
    })
    if (response.status === 429) {
      cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS
      console.warn('[izumi comments] Discuss Anime rate limit reached; pausing requests for 60 seconds')
      return []
    }
    if (!response.ok) {
      console.warn(`[izumi comments] Discuss Anime API returned HTTP ${response.status}`)
      return []
    }
    const body = await response.json() as ThreadsResponse
    const rows = Array.isArray(body?.threads) ? body.threads.filter(isThread) : []
    const hit = matchDiscussAnimeThread(rows, episode, media.format === 'MOVIE')
    return hit ? [mapDiscussAnimeThread(hit)] : []
  } catch (error) {
    console.warn('[izumi comments] Discuss Anime lookup failed:', error)
    return []
  }
}
