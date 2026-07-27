import type { Stream } from './parse'

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

const STORAGE_KEY = 'dead-sources-v1'

interface Entry { until: number; hits: number }

let entries: Record<string, Entry> | null = null

function load(): Record<string, Entry> {
  if (entries) return entries
  entries = {}
  try {
    if (typeof localStorage === 'undefined') return entries
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

/** Stable identity for a source. Returns '' when there is nothing durable to key on.
 *
 *  Hash-first and hash-ONLY for torrents: the same release comes back from several addons under
 *  different resolve URLs, and a failure is normally torrent-level, so keying on the hash means one
 *  failure covers every copy of it — including the next episode of a batch, which is exactly where
 *  cross-episode continuity kept re-picking the same broken pack. */
export function fingerprint(s: Stream): string {
  if (s.infoHash) return `h:${s.infoHash.toLowerCase()}`
  if (s.url) return `u:${s.url}`
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
