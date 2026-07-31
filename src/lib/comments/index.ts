import { invokeNativeHttp } from '$lib/net/http'
import { get } from 'svelte/store'
import {
  createDiscussionClient, type DiscussionClient, type HttpAdapter,
  type Thread as SdkThread, type Comment as SdkComment,
} from '@nicholasyoannou/hayami-sdk'
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
const http: HttpAdapter = async (url, init) => {
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
const discussionCache = new Map<string, { at: number; value: Promise<DiscussionThread[]> }>()

/** Drop every memoized discussion (used by tests; also safe to call on sign-in changes). */
export function clearDiscussionCache() {
  discussionCache.clear()
}

/** Fetch episode-discussion threads (with inline comments where available) for a title. Best-effort.
 *  Memoized per (anilistId, malId, episode) — see `discussionKey`. */
export function fetchDiscussion(media: Media, episode: number | null | undefined): Promise<DiscussionThread[]> {
  const key = discussionKey(media, episode)
  const hit = discussionCache.get(key)
  if (hit && Date.now() - hit.at < DISCUSSION_TTL_MS) return hit.value

  // An empty result is "nothing found YET" as often as it is "nothing exists" — a transient SDK/network
  // failure returns [] too (getDiscussion never rejects). Caching that would hide real comments for the
  // whole TTL, so only a non-empty aggregation is retained.
  const value = fetchDiscussionUncached(media, episode).then((threads) => {
    if (!threads.length && discussionCache.get(key)?.value === value) discussionCache.delete(key)
    return threads
  })
  discussionCache.set(key, { at: Date.now(), value })
  // Map iteration is insertion-ordered, so the first key is the oldest entry.
  while (discussionCache.size > DISCUSSION_CACHE_MAX) {
    const oldest = discussionCache.keys().next()
    if (oldest.done) break
    discussionCache.delete(oldest.value)
  }
  return value
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
