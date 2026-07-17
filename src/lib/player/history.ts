import { persisted } from 'svelte-persisted-store'
import { get, writable } from 'svelte/store'
import { saveLocalHistory } from '$lib/settings/ui'
import type { Media } from '$lib/anilist/types'
import { clearSourceOrigins, forgetSourceOrigin } from './source-origin'

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
  // Release identity of the last source played for this show (parsed group + Stremio bingeGroup),
  // so Continue Watching can resume the SAME release without re-opening the picker.
  release?: { group?: string; bingeGroup?: string }
}

/** Persisted local watch history: `mediaId -> HistoryEntry`. */
export const localHistory = persisted<Record<number, HistoryEntry>>('local-history', {})

// Session-only progress keeps tracker-backed Continue Watching rows reactive even when the user has
// disabled persisted local history. It is deliberately not saved across launches.
export const sessionProgress = writable<Record<number, number>>({})

// Only the fields the cards / resume / MAL export actually read — NOT description/relations/etc,
// which the detail-page media object carries and would bloat localStorage (quota + per-play rewrite).
// Exported so the Continue-Watching snapshot stores the same trimmed shape.
export function mediaSnapshot(m: Media): Media {
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

/** Record that an episode was OPENED (updates last-opened episode + timestamp + the release just
 *  played). Does NOT bump the watched count — opening isn't finishing; `recordProgress` does that.
 *  A release with neither group nor bingeGroup (e.g. an offline/direct play) keeps the prior one.
 *  No-op when history is off. */
export function recordPlay(media: Media, episode: number | undefined, release?: { group?: string; bingeGroup?: string }) {
  if (episode == null || !get(saveLocalHistory)) return
  const rel = release && (release.group || release.bingeGroup) ? release : undefined
  localHistory.update((h) => {
    const prev = h[media.id]
    return { ...h, [media.id]: {
      media: mediaSnapshot(media),
      episode,
      progress: prev?.progress ?? 0,
      updatedAt: Date.now(),
      release: rel ?? prev?.release,
    } }
  })
}

/** Record that an episode was WATCHED (crossed the completion threshold) — bumps the in-session
 *  count, plus persisted local history when enabled. Mirrors what we push to the trackers. */
export function recordProgress(media: Media, episode: number) {
  sessionProgress.update((progress) => ({
    ...progress,
    [media.id]: Math.max(progress[media.id] ?? 0, episode),
  }))
  if (!get(saveLocalHistory)) return
  localHistory.update((h) => {
    const prev = h[media.id]
    return { ...h, [media.id]: {
      media: mediaSnapshot(media),
      episode: Math.max(prev?.episode ?? 0, episode),
      progress: Math.max(prev?.progress ?? 0, episode),
      updatedAt: Date.now(),
      release: prev?.release, // keep the remembered release across a progress bump
    } }
  })
}

/** Drop one anime from local history. */
export function forgetMedia(mediaId: number) {
  localHistory.update((h) => { const n = { ...h }; delete n[mediaId]; return n })
  forgetSourceOrigin(mediaId)
}

/** Wipe all local watch history. */
export function clearHistory() {
  localHistory.set({})
  clearSourceOrigins()
}

/** History entries as a most-recently-updated-first array (for Continue Watching / the settings list). */
export function historyEntries(h: Record<number, HistoryEntry>): HistoryEntry[] {
  return Object.values(h).sort((a, b) => b.updatedAt - a.updatedAt)
}
