import { invokeNativeHttp } from '$lib/net/http'
import { get } from 'svelte/store'
import {
  createDiscussionClient, type DiscussionClient, type HttpAdapter,
  type Thread as SdkThread, type Comment as SdkComment,
} from '@nicholasyoannou/hayami-sdk'
import {
  byAnimeUrl, matchEpisodeThread, rowToThreadRef,
  type AnimeThreadRow, type ByAnimeResponse,
} from '@nicholasyoannou/hayami-sdk/forum'
import { anilistToken } from '$lib/anilist/auth'
import { commentsBackendUrl } from './config'
import type { Media } from '$lib/anilist/types'
import type { DiscussionThread, DiscussionComment } from './types'

export type { DiscussionThread, DiscussionComment, ScriptEmbed } from './types'
export { commentsBackendUrl, defaultDiscussionPlatform, discussionExpanded } from './config'

// The discussion aggregation (map id+episode → per-platform threads + comments across Reddit / AniList
// / MAL / YouTube / the forum) is provided by the headless SDK. izumi supplies only the pieces the SDK
// can't have: a CORS-free HTTP adapter (its Rust `ext_fetch`, which forwards any header — User-Agent /
// Referer / Authorization — un-stripped, unlike the webview fetch) and the AniList token for authed
// reads/posts. Reddit/AniList/MAL/YouTube need no backend; the forum comes from the user-set mapper URL.
const performHttp: HttpAdapter = async (url, init) => {
  const r = await invokeNativeHttp<{ status: number; headers: Record<string, string>; body: string }>('ext_fetch', {
    url, method: init?.method ?? 'GET', headers: init?.headers, body: init?.body,
  })
  return {
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    headers: r.headers,
    text: async () => r.body,
    json: async () => JSON.parse(r.body),
  }
}

// The early forum lookup and Hayami's full aggregation ask for the same anonymous mapper URL.
// Share that exact GET so mounting Disqus early does not double network traffic.
const anonymousGetInflight = new Map<string, ReturnType<HttpAdapter>>()
const http: HttpAdapter = (url, init) => {
  const method = (init?.method ?? 'GET').toUpperCase()
  const anonymousGet = method === 'GET' && !init?.body && !Object.keys(init?.headers ?? {}).length
  if (!anonymousGet) return performHttp(url, init)
  const running = anonymousGetInflight.get(url)
  if (running) return running
  const request = performHttp(url, init)
  anonymousGetInflight.set(url, request)
  void request.then(
    () => anonymousGetInflight.delete(url),
    () => anonymousGetInflight.delete(url),
  )
  return request
}

// SDK platform slug → the badge label izumi's panel shows.
const label = (p: string) =>
  p === 'anilist' ? 'AniList' : p === 'mal' ? 'MAL' : p === 'youtube' ? 'YouTube'
    : p === 'animecommunity' ? 'Anime Community'
    // 'forum' = the discussanime archive embed; it's Disqus-backed (Chuunime runs on Disqus), so the
    // user sees it as "Disqus" — same label as the live 'disqus' platform. A thread is one or the other.
    : p === 'forum' ? 'Disqus' : p.charAt(0).toUpperCase() + p.slice(1)

// Map the SDK's normalized shapes onto the panel's (keeps the UI decoupled from the SDK). Comment
// bodies use `bodyText` — the SDK's pre-stripped plain text — since izumi has no HTML sanitizer.
function mapComment(c: SdkComment): DiscussionComment {
  return {
    id: `${c.platform}-${c.id}`, source: label(c.platform), author: c.author, authorAvatar: c.authorAvatar,
    body: c.bodyText, score: c.score, createdAt: c.createdAt, url: c.url, replies: c.replies?.map(mapComment),
  }
}
function mapThread(t: SdkThread): DiscussionThread {
  return {
    id: `${t.platform}-${t.id}`, source: label(t.platform), title: t.title, url: t.url, author: t.author,
    createdAt: t.createdAt, replyCount: t.replyCount, comments: t.comments?.map(mapComment),
    embedUrl: t.embedUrl, // Disqus/forum embed → the panel renders it inline as an iframe.
    scriptEmbed: t.scriptEmbed, // TAC → the panel hosts the script in a loader page.
  }
}

// One client per call (cheap; picks up the current mapper URL + AniList token each time). The Disqus
// loader page fetches its reaction counts directly (CORS-open), so the app doesn't wire the SDK's
// getReactions/react here — see static/disqus-embed.html.
function makeClient(): DiscussionClient {
  return createDiscussionClient({
    http,
    mapperBaseUrl: get(commentsBackendUrl) || undefined, // forum source; empty ⇒ SDK's default / disabled
    getToken: (p) => (p === 'anilist' ? get(anilistToken) || undefined : undefined),
  })
}

/**
 * Identity of the DISCUSSION, not of the object that carried it. `nowPlaying`/`nowPlayingMedia` are
 * replaced wholesale on every source change — "Change source", and above all the recovery watchdog
 * cycling through releases that fail to start — and Svelte 5 props are lazy getters, so every
 * consumer effect re-runs on each of those. Keyed on ids + episode, a re-run is a cache hit.
 */
export const discussionKey = (media: Media, episode: number | null | undefined) =>
  `${media.id}:${media.idMal ?? ''}:${episode ?? ''}`

// The aggregation is a fan-out (Reddit search + AniList + MAL + YouTube + the configured mapper), so
// re-issuing it for an episode whose comments cannot have changed is pure rate-limit burn. The entry
// holds the PROMISE, so concurrent callers (the in-player panel and the Android watch page both ask
// on open) share one round of requests instead of racing two.
const DISCUSSION_TTL_MS = 10 * 60 * 1000
const DISCUSSION_CACHE_MAX = 32
type DiscussionCacheEntry = {
  at: number
  value: Promise<DiscussionThread[]>
  early: Promise<DiscussionThread[]>
  complete: boolean
}
const discussionCache = new Map<string, DiscussionCacheEntry>()

/** Drop every memoized discussion (used by tests; also safe to call on sign-in changes). */
export function clearDiscussionCache() {
  discussionCache.clear()
}

/** Fetch episode-discussion threads (with inline comments where available) for a title. Best-effort.
 *  Memoized per (anilistId, malId, episode) — see `discussionKey`. */
export function fetchDiscussion(
  media: Media,
  episode: number | null | undefined,
  onEarly?: (threads: DiscussionThread[]) => void,
): Promise<DiscussionThread[]> {
  const key = discussionKey(media, episode)
  const hit = discussionCache.get(key)
  if (hit && Date.now() - hit.at < DISCUSSION_TTL_MS) {
    deliverEarly(hit, onEarly)
    return hit.value
  }

  // An empty result is "nothing found YET" as often as it is "nothing exists" — a transient SDK/network
  // failure returns [] too (getDiscussion never rejects). Caching that would hide real comments for the
  // whole TTL, so only a non-empty aggregation is retained.
  const early = fetchForumUncached(media, episode)
  const value = Promise.all([fetchDiscussionUncached(media, episode), early])
    .then(([threads, forum]) => [
      ...forum,
      ...threads.filter((thread) => !forum.some((fast) => fast.id === thread.id)),
    ])
    .then((threads) => {
    if (!threads.length && discussionCache.get(key)?.value === value) discussionCache.delete(key)
    return threads
  })
  const entry = { at: Date.now(), value, early, complete: false }
  void value.then(
    () => { entry.complete = true },
    () => { entry.complete = true },
  )
  discussionCache.set(key, entry)
  deliverEarly(entry, onEarly)
  // Map iteration is insertion-ordered, so the first key is the oldest entry.
  while (discussionCache.size > DISCUSSION_CACHE_MAX) {
    const oldest = discussionCache.keys().next()
    if (oldest.done) break
    discussionCache.delete(oldest.value)
  }
  return value
}

function deliverEarly(entry: DiscussionCacheEntry, callback?: (threads: DiscussionThread[]) => void) {
  if (!callback || entry.complete) return
  // Only publish the forum-only result when it beats the full aggregation. This prevents a late
  // early result from replacing an already-complete source list in the UI.
  void Promise.race([
    entry.early.then((threads) => ({ early: true, threads })),
    entry.value.then(() => ({ early: false, threads: [] as DiscussionThread[] })),
  ]).then((result) => { if (result.early && result.threads.length) callback(result.threads) })
}

async function fetchForumUncached(
  media: Media,
  episode: number | null | undefined,
): Promise<DiscussionThread[]> {
  const base = get(commentsBackendUrl).trim().replace(/\/+$/, '')
  if (!base) return []
  const episodeHint = typeof episode === 'number' && episode > 0 ? episode : null
  const url = byAnimeUrl(base, {
    malId: media.idMal ?? undefined,
    anilistId: media.id,
    episodeHint,
    limit: 50,
    page: 1,
  })
  if (!url) return []
  try {
    const response = await http(url)
    if (!response.ok) return []
    const body = await response.json() as ByAnimeResponse
    const rows: AnimeThreadRow[] = Array.isArray(body?.threads) ? body.threads : []
    const hit = matchEpisodeThread(rows, {
      episodeCandidates: [episode],
      isMovie: media.format === 'MOVIE',
    })
    if (!hit) return []
    const ref = rowToThreadRef(hit)
    return [mapThread({ ...ref, title: hit.title ?? '', replyCount: ref.commentCount })]
  } catch (error) {
    console.warn('[izumi comments] fast forum lookup failed:', error)
    return []
  }
}

async function fetchDiscussionUncached(media: Media, episode: number | null | undefined): Promise<DiscussionThread[]> {
  const titles = [...new Set([media.title.romaji, media.title.english, media.title.userPreferred].filter((t): t is string => !!t))]
  const client = makeClient()
  try {
    const threads = await client.getDiscussion(
      { anilistId: media.id, malId: media.idMal ?? undefined, titles, episode: episode ?? null, isMovie: media.format === 'MOVIE' },
      { withComments: true },
    )
    // DIAGNOSTIC (temporary): what the SDK returned for this title/episode.
    console.log('[izumi comments] sdk returned', threads.length, 'thread(s):', threads.map((t) => `${t.platform}(${t.comments?.length ?? 0})`).join(', '))
    return threads.map(mapThread)
  }
  catch (e) { console.warn('[izumi comments] getDiscussion failed:', e); return [] }
}
