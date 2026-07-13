// Normalized discussion shapes the in-player panel renders, independent of which platform a thread /
// comment came from (AniList forums, a mapped Reddit/forum/YouTube source, …). Bodies are PLAIN TEXT
// (already stripped of markup) — the app has no HTML sanitizer, so providers must not hand raw HTML in.

/** A discussion thread for a title/episode. `source` is a generic platform label for the UI badge. */
export interface DiscussionThread {
  id: string
  source: string
  title: string
  author?: string
  authorAvatar?: string
  body?: string
  replyCount?: number
  score?: number
  createdAt?: number // unix ms
  url?: string       // open-in-browser permalink
  comments?: DiscussionComment[] // inline comments (platforms that expose bodies as JSON, e.g. Reddit)
  embedUrl?: string  // iframe-able embed (Disqus/forum) — rendered inline instead of a link-out
  scriptEmbed?: ScriptEmbed // script-mounted embed (TAC) — the panel hosts it in a loader page
}

/** A script-injected embed: a consumer sets `window[configVar] = config`, adds `<div id=containerId>`,
 *  then loads `<script id=scriptId src=scriptSrc>`. Used by The Anime Community. Mirrors the SDK shape. */
export interface ScriptEmbed {
  scriptSrc: string
  scriptId: string
  containerId: string
  configVar: string
  config: Record<string, string | number>
}

/** A single comment inside a thread (replies nested for platforms that expose a tree). */
export interface DiscussionComment {
  id: string
  source: string
  author?: string
  authorAvatar?: string
  body: string
  score?: number
  createdAt?: number // unix ms
  url?: string
  replies?: DiscussionComment[]
}
