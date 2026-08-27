import { airedCount } from '$lib/anilist/media'
import type { Media } from '$lib/anilist/types'
import type { Entry } from '$lib/anilist/lists'
import type { MalListEntry } from '$lib/trackers'

// One Watchlist row: a watching-list entry plus the derived "how far behind" data the
// behind-first ordering needs. progress merges connected trackers (max wins — tolerates a
// stale sync on either side); updatedAt is in ms.
export interface WatchlistItem {
  media: Media
  progress: number
  updatedAt: number
  behind: number
  lastAiredAt?: number // seconds — airingAt of the newest aired schedule node, if known
}

/** Aired-but-unwatched episode count, >= 0. airedCount() returns Infinity when a title
 *  carries no episode signal at all — that means "unknown", not "infinitely behind". */
export function behindCount(m: Media, progress: number): number {
  const aired = airedCount(m)
  if (!Number.isFinite(aired)) return 0
  return Math.max(0, aired - progress)
}

/** airingAt (unix s) of the newest already-aired schedule node; undefined without one. */
export function lastAiredAt(m: Media, nowMs = Date.now()): number | undefined {
  const now = nowMs / 1000
  let best: number | undefined
  for (const n of m.airingSchedule?.nodes ?? [])
    if (n.airingAt <= now && (best === undefined || n.airingAt > best)) best = n.airingAt
  return best
}

/** Merge AniList entries + MAL entries (resolved to AniList media via malMedia) into sorted
 *  Watchlist rows: behind shows first (newest-aired on top), then caught-up shows by soonest
 *  next episode; ties fall back to most-recently-updated. */
export function buildWatchlist(
  ani: Entry[], mal: MalListEntry[], malMedia: Media[], nowMs = Date.now(),
): WatchlistItem[] {
  const byId = new Map<number, { media: Media; progress: number; updatedAt: number }>()
  for (const e of ani) {
    const updatedAt = (e.updatedAt ?? 0) * 1000
    const previous = byId.get(e.media.id)
    if (previous) {
      previous.progress = Math.max(previous.progress, e.progress)
      previous.updatedAt = Math.max(previous.updatedAt, updatedAt)
    } else {
      byId.set(e.media.id, { media: e.media, progress: e.progress, updatedAt })
    }
  }
  const malByIdMal = new Map(malMedia.map((m) => [m.idMal, m]))
  for (const e of mal) {
    const m = malByIdMal.get(e.idMal)
    if (!m) continue // no AniList record for this MAL id — nothing to render
    const prev = byId.get(m.id)
    if (prev) {
      prev.progress = Math.max(prev.progress, e.progress)
      prev.updatedAt = Math.max(prev.updatedAt, e.updatedAt)
    }
    else byId.set(m.id, { media: m, progress: e.progress, updatedAt: e.updatedAt })
  }
  const items: WatchlistItem[] = [...byId.values()].map((v) => ({
    ...v, behind: behindCount(v.media, v.progress), lastAiredAt: lastAiredAt(v.media, nowMs),
  }))
  const behind = items.filter((i) => i.behind > 0)
    .sort((a, b) => (b.lastAiredAt ?? 0) - (a.lastAiredAt ?? 0) || b.updatedAt - a.updatedAt)
  const caught = items.filter((i) => i.behind === 0)
    .sort((a, b) =>
      (a.media.nextAiringEpisode?.timeUntilAiring ?? Infinity) - (b.media.nextAiringEpisode?.timeUntilAiring ?? Infinity)
      || b.updatedAt - a.updatedAt)
  return [...behind, ...caught]
}
