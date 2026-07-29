import type { Stream } from './parse'
import { torrentioResolverInfoHash } from './resolver-url'

// Sources that failed to play, remembered across episodes.
//
// Without this, a broken release is re-chosen forever: cross-episode continuity deliberately
// re-picks the previous episode's release by name, so one dead batch torrent fails on EVERY
// episode of an auto-advance run, each time costing the user the same resolve and the same error.
//
// Deliberately soft. Nothing here HIDES a source — a remembered failure only de-ranks it out of
// the automatic pick and dims it in the list, because "failed" covers a debrid hiccup and an
// expired token as readily as a genuinely dead torrent, and a source the user picks by hand must
// always be allowed to try again.

/** First failure: short enough that a transient debrid outage heals itself within one sitting. */
export const DEAD_MS = 4 * 60 * 60 * 1000
/** Failed again inside its window — treat it as genuinely broken rather than unlucky. */
export const DEAD_REPEAT_MS = 7 * 24 * 60 * 60 * 1000

const STORAGE_KEY = 'dead-sources-v5'
// v1 keyed rows on their raw URL, which for a debrid resolver row embedded the user's API key.
// Those records are actively deleted rather than merely abandoned — leaving them in place would
// keep a credential on disk for as long as the browser profile lives.
// v2 also contains false torrent failures from the brief player_embed/FileStream race: healthy
// sources were deselected before mpv opened them, then persisted as dead by the recovery chain.
// v3 may also contain failures written by a stale recovery task after another anime took over.
// v4 can contain failures caused by a late progress event from the previous file prematurely
// transitioning the newly activated torrent into stream-only mode.
const LEGACY_KEYS = ['dead-sources-v1', 'dead-sources-v2', 'dead-sources-v3', 'dead-sources-v4']

interface Entry { until: number; hits: number }

let entries: Record<string, Entry> | null = null

function load(): Record<string, Entry> {
  if (entries) return entries
  entries = {}
  try {
    if (typeof localStorage === 'undefined') return entries
    for (const stale of LEGACY_KEYS) localStorage.removeItem(stale)
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) entries = JSON.parse(raw) as Record<string, Entry>
  } catch { entries = {} }
  return entries!
}

function save(now: number) {
  if (!entries) return
  // Drop expired keys on write so the record can't grow without bound across a long install.
  for (const [k, v] of Object.entries(entries)) if (v.until <= now) delete entries[k]
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch { /* private mode / quota — the in-memory copy still works for this session */ }
}

/** Non-reversible, stable digest. Used so a URL can identify a source WITHOUT being stored: these
 *  records are persisted for days, and a debrid resolver URL carries the user's own API key in its
 *  path. FNV-1a — collision risk is irrelevant for a per-install de-ranking hint. */
function digest(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16)
}

/** Stable identity for a source. Returns '' when there is nothing durable to key on.
 *
 *  Hash-first and hash-ONLY for torrents: the same release comes back from several addons under
 *  different resolve URLs, and a failure is normally torrent-level, so keying on the hash means one
 *  failure covers every copy of it — including the next episode of a batch, which is exactly where
 *  cross-episode continuity kept re-picking the same broken pack.
 *
 *  A debrid resolver URL is a torrent too: the infohash is right there in the path, so recover it
 *  rather than treating the row as a one-off. That is both more correct — one failure now covers
 *  every addon offering the release — and the reason no credential reaches storage, since the raw
 *  URL embeds the user's debrid API key and this record outlives the session. Any other URL is
 *  digested for the same reason. */
export function fingerprint(s: Stream): string {
  if (s.infoHash) return `h:${s.infoHash.toLowerCase()}`
  const viaResolver = torrentioResolverInfoHash(s.url, s.__addonName ?? s.name)
  if (viaResolver) return `h:${viaResolver}`
  if (s.url) return `u:${digest(s.url)}`
  const label = s.behaviorHints?.filename || s.title?.split('\n')[0] || s.name || ''
  const origin = s.__origin?.id
  return origin && label ? `t:${origin}:${label}` : ''
}

export function markDead(s: Stream, now = Date.now()): void {
  const key = fingerprint(s)
  if (!key) return
  const all = load()
  const prior = all[key]
  // Still inside its window ⇒ this is a repeat, not a fresh piece of bad luck.
  const repeat = !!prior && prior.until > now
  all[key] = { until: now + (repeat ? DEAD_REPEAT_MS : DEAD_MS), hits: (prior?.hits ?? 0) + 1 }
  save(now)
}

export function isDead(s: Stream, now = Date.now()): boolean {
  const key = fingerprint(s)
  if (!key) return false
  return (load()[key]?.until ?? 0) > now
}

/** Test seam, and the hook behind a future "forget failed sources" settings action. */
export function forgetDead(): void {
  entries = {}
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)
  } catch { /* ignore */ }
}
