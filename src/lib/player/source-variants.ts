// Sibling-source lookups for the in-player "switch to dub" / "switch server" controls. Online
// providers (Seanime-style direct streams) commonly resolve several rows for the SAME episode on
// the SAME site — one per audio flavour and/or extractor server — and the player already keeps
// the full candidate pool alive in playbackRecovery.streams (session.ts) for watchdog recovery.
// These helpers mine that pool for the OTHER rows of the current source without re-resolving
// anything, so a swap is instant and keeps playback position.
import { describe, qualityLabel } from '$lib/stremio/addon'
import type { Stream } from '$lib/stremio/addon'

/** Same-provider identity for online rows. Torrent/debrid rows carry no __stream flag and have
 *  no server/audio siblings to offer — a torrent's "provider" is the indexer, not a site session. */
const providerOf = (s: Stream): string | undefined =>
  s.__stream ? (s.__origin?.id ?? s.__origin?.name ?? s.__addonName) : undefined

// Numeric quality for comparison/display. Prefers the provider's OWN __quality string over the
// heuristic describe(s).quality: resolutionOf greps the whole display name, and a server token
// like "HD-1" satisfies its `\bhd\b` branch, fabricating 720p for a stream whose provider never
// reported a resolution at all (typically an adaptive "auto" ladder). __quality is present but
// 'auto'/blank on those rows — a known-unknown, so it does NOT fall through to the heuristic.
// __quality absent entirely (e.g. a torrent row) is the only case that falls back to describe().
function quality(s: Stream): number | undefined {
  if (s.__quality !== undefined) {
    const raw = s.__quality.trim().toLowerCase()
    if (!raw || raw === 'auto') return undefined
    const n = Number(raw.match(/\d+/)?.[0])
    return Number.isFinite(n) && n > 0 ? n : undefined
  }
  return describe(s).quality || undefined
}

// Two unknown qualities are NOT a match — `undefined === undefined` would otherwise tie every
// "auto" row together and let audioCounterpart treat them as deliberately-matched quality.
const sameQuality = (a: Stream, b: Stream): boolean => {
  const qa = quality(a)
  const qb = quality(b)
  return qa != null && qb != null && qa === qb
}

/** The same episode on the same site in the OTHER audio flavour, preferring the same server, then
 *  the same quality — so a swap changes as little as possible beyond the audio track. */
export function audioCounterpart(current: Stream, pool: Stream[]): Stream | undefined {
  const provider = providerOf(current)
  const audio = current.__audio
  if (!provider || !audio) return undefined
  const wanted = audio === 'sub' ? 'dub' : 'sub'
  const candidates = pool.filter((s) =>
    s !== current && providerOf(s) === provider && s.__audio === wanted && !!s.url)
  if (!candidates.length) return undefined
  return candidates.find((s) => s.__server === current.__server && sameQuality(s, current))
    ?? candidates.find((s) => s.__server === current.__server)
    ?? candidates.find((s) => sameQuality(s, current))
    ?? candidates[0]
}

/** Alternate servers/qualities for the current source: same site, same audio flavour, a
 *  different URL. Excludes the current row itself and any duplicate pointing at the same URL. */
export function serverSiblings(current: Stream, pool: Stream[]): Stream[] {
  const provider = providerOf(current)
  if (!provider) return []
  return pool.filter((s) =>
    s !== current && providerOf(s) === provider && s.__audio === current.__audio
    && !!s.url && s.url !== current.url)
}

// A provider that only ever exposes one extractor names it "default" — showing that in a menu of
// alternatives says nothing, so it's dropped rather than displayed.
const isDefaultServer = (server?: string) => !server || /^default$/i.test(server)

/** Host of the stream URL, as a stand-in server identity.
 *
 *  Plenty of sources reach the menu with no server name at all: videoSourceToStream drops a server
 *  the provider called "default", and the Aniyomi bridge only recovers one from a video title
 *  shaped exactly like "HD-1 - Sub - 1080p". Those rows are still genuinely DIFFERENT mirrors, and
 *  what actually distinguishes them is the host they stream from — so show that rather than
 *  repeating the quality on every row. `www.` is noise; a bare IP or unparseable URL yields
 *  nothing and falls through to the caller's next fallback. */
function hostOf(s: Stream): string | undefined {
  try {
    const host = new URL(s.url ?? '').hostname.replace(/^www\./i, '')
    return host && !/^\d+\.\d+\.\d+\.\d+$/.test(host) ? host : undefined
  } catch { return undefined }
}

/** Short menu label: server (or the streaming host when the provider named none), then quality
 *  when it says something — "HD-2 · 1080p", "vidcdn.example · 720p". Falls back to the row's own
 *  name/addon label when nothing else is informative. */
export function variantLabel(s: Stream): string {
  const parts: string[] = []
  const server = isDefaultServer(s.__server) ? hostOf(s) : s.__server
  if (server) parts.push(server)
  const q = quality(s)
  if (q != null) parts.push(qualityLabel(q))
  if (parts.length) return parts.join(' · ')
  return s.name || s.__addonName || 'Stream'
}

/** Labels for a MENU of variants, guaranteed distinct.
 *
 *  A list of identical rows is worse than useless — it looks broken and gives the user no basis to
 *  choose. Two mirrors can legitimately reduce to the same server+quality text, so any collision is
 *  numbered ("HD-1 · 1080p (2)"). Order matches the input, and a row that is already unique is
 *  never decorated. */
export function variantLabels(rows: Stream[]): string[] {
  const seen = new Map<string, number>()
  return rows.map((s) => {
    const base = variantLabel(s)
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return n === 1 ? base : `${base} (${n})`
  })
}
