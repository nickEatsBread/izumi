import { invoke } from '@tauri-apps/api/core'
import { get } from 'svelte/store'
import { createDiscussionClient, type HttpAdapter, type Thread as SdkThread, type Comment as SdkComment } from '@nicholasyoannou/hayami-sdk'
import { anilistToken } from '$lib/anilist/auth'
import { commentsBackendUrl } from './config'
import type { Media } from '$lib/anilist/types'
import type { DiscussionThread, DiscussionComment } from './types'

export type { DiscussionThread, DiscussionComment } from './types'
export { commentsBackendUrl, commentsEnabled, defaultDiscussionPlatform } from './config'

// The discussion aggregation (map id+episode → per-platform threads + comments across Reddit / AniList
// / MAL / YouTube / the forum) is provided by the headless SDK. izumi supplies only the pieces the SDK
// can't have: a CORS-free HTTP adapter (its Rust `ext_fetch`, which forwards any header — User-Agent /
// Referer / Authorization — un-stripped, unlike the webview fetch) and the AniList token for authed
// reads/posts. Reddit/AniList/MAL/YouTube need no backend; the forum comes from the user-set mapper URL.
const http: HttpAdapter = async (url, init) => {
  const r = await invoke<{ status: number; headers: Record<string, string>; body: string }>('ext_fetch', {
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
  p === 'anilist' ? 'AniList' : p === 'mal' ? 'MAL' : p === 'youtube' ? 'YouTube' : p.charAt(0).toUpperCase() + p.slice(1)

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
    // Present for Disqus/forum threads once the SDK carries it on the getDiscussion Thread (currently
    // only on ThreadRef) — see the note to the SDK. Rendered as an inline iframe by the panel.
    embedUrl: (t as { embedUrl?: string }).embedUrl,
  }
}

/** Fetch episode-discussion threads (with inline comments where available) for a title. Best-effort. */
export async function fetchDiscussion(media: Media, episode: number | null | undefined): Promise<DiscussionThread[]> {
  const titles = [...new Set([media.title.romaji, media.title.english, media.title.userPreferred].filter((t): t is string => !!t))]
  const client = createDiscussionClient({
    http,
    mapperBaseUrl: get(commentsBackendUrl) || undefined, // forum source; empty ⇒ SDK's default / disabled
    getToken: (p) => (p === 'anilist' ? get(anilistToken) || undefined : undefined),
  })
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
