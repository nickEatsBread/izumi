import { persisted } from 'svelte-persisted-store'
import { get } from 'svelte/store'
import { saveLocalHistory } from '$lib/settings/ui'
import type { Media } from '$lib/anilist/types'

// Local watch history — saved on-device regardless of whether AniList/MyAnimeList is linked, so
// Continue Watching (and resume) work with no account. One entry per anime, keyed by AniList media
// id. `progress` is the number of episodes actually WATCHED to completion (what a tracker's
// mediaListEntry.progress / a MAL export should report); `episode` is the last one OPENED (the row
// resumes there even if it isn't finished). `updatedAt` orders the row. A trimmed `media` snapshot
// is stored so cards render offline without a re-fetch — and without dragging the synopsis + every
// related-anime object (from the detail query) into localStorage.
export interface HistoryEntry {
  media: Media
  episode: number
  progress: number
  updatedAt: number
}

/** Persisted local watch history: `mediaId -> HistoryEntry`. */
export const localHistory = persisted<Record<number, HistoryEntry>>('local-history', {})

// Only the fields the cards / resume / MAL export actually read — NOT description/relations/etc,
// which the detail-page media object carries and would bloat localStorage (quota + per-play rewrite).
function mediaSnapshot(m: Media): Media {
  return {
    id: m.id,
    idMal: m.idMal,
    title: m.title,
    coverImage: m.coverImage,
    bannerImage: m.bannerImage,
    episodes: m.episodes,
    format: m.format,
    status: m.status,
    seasonYear: m.seasonYear,
    averageScore: m.averageScore,
    genres: m.genres,
    nextAiringEpisode: m.nextAiringEpisode,
  } as Media
}

/** Record that an episode was OPENED (updates last-opened episode + timestamp). Does NOT bump the
 *  watched count — opening isn't finishing; `recordProgress` does that. No-op when history is off. */
export function recordPlay(media: Media, episode: number | undefined) {
  if (episode == null || !get(saveLocalHistory)) return
  localHistory.update((h) => {
    const prev = h[media.id]
    return { ...h, [media.id]: {
      media: mediaSnapshot(media),
      episode,
      progress: prev?.progress ?? 0,
      updatedAt: Date.now(),
    } }
  })
}

/** Record that an episode was WATCHED (crossed the completion threshold) — bumps the watched count
 *  to at least that episode. Mirrors what we push to the trackers, but always local. No-op when off. */
export function recordProgress(media: Media, episode: number) {
  if (!get(saveLocalHistory)) return
  localHistory.update((h) => {
    const prev = h[media.id]
    return { ...h, [media.id]: {
      media: mediaSnapshot(media),
      episode: Math.max(prev?.episode ?? 0, episode),
      progress: Math.max(prev?.progress ?? 0, episode),
      updatedAt: Date.now(),
    } }
  })
}

/** Drop one anime from local history. */
export function forgetMedia(mediaId: number) {
  localHistory.update((h) => { const n = { ...h }; delete n[mediaId]; return n })
}

/** Wipe all local watch history. */
export function clearHistory() {
  localHistory.set({})
}

/** History entries as a most-recently-updated-first array (for Continue Watching / the settings list). */
export function historyEntries(h: Record<number, HistoryEntry>): HistoryEntry[] {
  return Object.values(h).sort((a, b) => b.updatedAt - a.updatedAt)
}
