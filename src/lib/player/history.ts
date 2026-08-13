import { persisted } from 'svelte-persisted-store'
import { derived, get, writable, type Readable } from 'svelte/store'
import { saveLocalHistory } from '$lib/settings/ui'
import { incognito, onIncognitoPurge } from '$lib/stores/incognito'
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

/** The PERSISTED history (`mediaId -> HistoryEntry`). Everything that must never see an incognito
 *  entry — export/import, device sync, airing notifications, the Continue Watching reconcile that
 *  writes the persisted snapshot — reads THIS store. Display paths read `localHistory` below. */
export const durableHistory = persisted<Record<number, HistoryEntry>>('local-history', {})

/** In-memory history for incognito plays. Merged into `localHistory` so Continue Watching, episode
 *  lists and resume all work during the session; wiped when incognito ends. Never persisted. */
export const incognitoHistory = writable<Record<number, HistoryEntry>>({})
onIncognitoPurge(() => incognitoHistory.set({}))

/** What the UI reads: persisted history overlaid with this session's incognito plays (an incognito
 *  entry for the same anime wins — it is by construction the newer one). Read-only by design: all
 *  writes go through the record/forget/clear functions, which route by incognito state. */
export const localHistory: Readable<Record<number, HistoryEntry>> = derived(
  [durableHistory, incognitoHistory],
  ([$durable, $incognito]) => ({ ...$durable, ...$incognito }),
)

// Session-only progress keeps tracker-backed Continue Watching rows reactive even when the user has
// disabled persisted local history. It is deliberately not saved across launches. Incognito plays
// do NOT write it (they live in incognitoHistory instead) — it feeds the persisted Continue
// Watching snapshot's only-increase floor, which must never learn an incognito count.
export const sessionProgress = writable<Record<number, number>>({})
/** Exact progress chosen from the episode tools. Unlike normal playback progress, this may move
 * backwards, so it must override the detail query's stale tracker snapshot until a refetch. */
export const manualProgressOverrides = writable<Record<number, number>>({})

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
    popularity: m.popularity,
    trending: m.trending,
    genres: m.genres,
    nextAiringEpisode: m.nextAiringEpisode,
    // Needed so Continue Watching can cap the aired/resume episode: many OVAs/ONAs and adult
    // titles have episodes + nextAiringEpisode both null and their ONLY episode-count signal
    // is the airing schedule. Without it airedCount() is Infinity → a caught-up show never
    // hides and its resume badge reads one past the finale (e.g. "Ep 5" of a 4-ep title).
    // Tiny (≤100 {episode,airingAt} nodes, capped by the query).
    airingSchedule: m.airingSchedule,
  } as Media
}

/** Record that an episode was OPENED (updates last-opened episode + timestamp + the release just
 *  played). Does NOT bump the watched count — opening isn't finishing; `recordProgress` does that.
 *  A release with neither group nor bingeGroup (e.g. an offline/direct play) keeps the prior one.
 *  No-op when history is off; in incognito it records to the in-memory overlay instead (the
 *  session still gets Continue Watching + same-release resume, nothing touches disk). */
export function recordPlay(media: Media, episode: number | undefined, release?: { group?: string; bingeGroup?: string }) {
  if (episode == null) return
  const target = get(incognito) ? incognitoHistory : durableHistory
  if (target === durableHistory && !get(saveLocalHistory)) return
  const rel = release && (release.group || release.bingeGroup) ? release : undefined
  target.update((h) => {
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
 *  count, plus persisted local history when enabled. Mirrors what we push to the trackers.
 *  In incognito the bump goes to the in-memory overlay only. */
export function recordProgress(media: Media, episode: number) {
  if (get(incognito)) {
    incognitoHistory.update((h) => {
      const prev = h[media.id]
      return { ...h, [media.id]: {
        media: mediaSnapshot(media),
        episode: Math.max(prev?.episode ?? 0, episode),
        progress: Math.max(prev?.progress ?? 0, episode),
        updatedAt: Date.now(),
        release: prev?.release,
      } }
    })
    return
  }
  sessionProgress.update((progress) => ({
    ...progress,
    [media.id]: Math.max(progress[media.id] ?? 0, episode),
  }))
  if (!get(saveLocalHistory)) return
  durableHistory.update((h) => {
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

/** Set an exact watched-through value from the detail-page tools. Remote tracker mutation is owned
 * by the caller; this updates the immediate local/session view, including deliberate rewinds. */
export function setLocalProgress(media: Media, progress: number) {
  const value = Math.max(0, Math.floor(progress))
  if (get(incognito)) {
    incognitoHistory.update((history) => {
      const previous = history[media.id]
      return { ...history, [media.id]: {
        media: mediaSnapshot(media),
        episode: value > 0 ? value : previous?.episode ?? 1,
        progress: value,
        updatedAt: Date.now(),
        release: previous?.release,
      } }
    })
    return
  }
  manualProgressOverrides.update((all) => ({ ...all, [media.id]: value }))
  sessionProgress.update((all) => ({ ...all, [media.id]: value }))
  if (!get(saveLocalHistory)) return
  durableHistory.update((history) => {
    const previous = history[media.id]
    return {
      ...history,
      [media.id]: {
        media: mediaSnapshot(media),
        episode: value > 0 ? value : previous?.episode ?? 1,
        progress: value,
        updatedAt: Date.now(),
        release: previous?.release,
      },
    }
  })
}

/** Drop one anime from local history (both the persisted store and any incognito overlay entry). */
export function forgetMedia(mediaId: number) {
  durableHistory.update((h) => { const n = { ...h }; delete n[mediaId]; return n })
  incognitoHistory.update((h) => { const n = { ...h }; delete n[mediaId]; return n })
  forgetSourceOrigin(mediaId)
}

/** Wipe all local watch history. */
export function clearHistory() {
  durableHistory.set({})
  incognitoHistory.set({})
  clearSourceOrigins()
}

/** History entries as a most-recently-updated-first array (for Continue Watching / the settings list). */
export function historyEntries(h: Record<number, HistoryEntry>): HistoryEntry[] {
  return Object.values(h).sort((a, b) => b.updatedAt - a.updatedAt)
}
