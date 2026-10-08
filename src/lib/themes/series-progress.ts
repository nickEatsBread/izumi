// The episodes of a series the viewer has watched, as card templates bind it (`episodesWatched`,
// Theme API 4). A list entry counts even at 0 ("0 | 12"); without one only finished episodes do, so
// a title the viewer never tracked or finished stays absent ("~ | 12"). `completed` (Theme API 4) is
// the same sources read as "the viewer has finished this series", for a watched badge.
import { derived, type Readable } from 'svelte/store'
import type { Media } from '$lib/anilist/types'
import { anilistIdOf } from '$lib/catalog/identity'
import { localLibrary, localTrackingKey, type LocalLibraryState } from '$lib/library/local-lists'
import { cwSnapshot, type CwEntry } from '$lib/player/continue-watching'
import { localHistory, manualProgressOverrides, sessionProgress } from '$lib/player/history'

export interface SeriesProgressSources {
  /** Tracker list progress by media id: the AniList and MyAnimeList entries the last Continue
   *  Watching sync read (`trackerProgress`). */
  tracker: ReadonlyMap<number, number>
  /** izumi's own list tracking by `localTrackingKey` (`localTrackingProgress`). */
  tracking: ReadonlyMap<string, number>
  /** The status of that tracking by the same key (`localTrackingStatuses`); it wins over the
   *  catalog's list entry, as on the series page. */
  statuses?: ReadonlyMap<string, string>
  /** Finished-episode counts recorded on this device, and this session's plays. */
  history: Readonly<Record<number, { progress: number }>>
  session: Readonly<Record<number, number>>
  /** Exact progress chosen from the episode tools; it wins outright, as on the series page. */
  overrides: Readonly<Record<number, number>>
}

/** A provider card and its mapped AniList id share one progress, as on the series page. */
const progressIds = (media: Media): number[] => {
  const canonical = anilistIdOf(media)
  return canonical == null ? [media.id] : [...new Set([media.id, canonical])]
}

/** The watched count for one series: a manual override first, then the larger of its list entries
 *  and the episodes finished here (list progress can lag a play that has not synced yet). */
export function seriesEpisodesWatched(media: Media, sources: SeriesProgressSources): number | undefined {
  const ids = progressIds(media)
  for (const id of ids) if (sources.overrides[id] != null) return sources.overrides[id]
  const listed = [
    media.mediaListEntry ? media.mediaListEntry.progress ?? 0 : undefined,
    sources.tracking.get(localTrackingKey(media)),
    ...ids.map((id) => sources.tracker.get(id)),
  ].filter((value): value is number => typeof value === 'number')
  const finished = Math.max(0, ...ids.flatMap((id) => [sources.history[id]?.progress ?? 0, sources.session[id] ?? 0]))
  if (listed.length) return Math.max(finished, ...listed)
  return finished > 0 ? finished : undefined
}

/** Whether the viewer has finished a series: its list status (izumi's own tracking first, then the
 *  catalog's list entry) is Completed, or the series has finished airing and the episodes watched
 *  reach its episode count. A rewatch in progress (Repeating) does not count as finished. */
export function seriesCompleted(media: Media, sources: SeriesProgressSources): boolean {
  const status = sources.statuses?.get(localTrackingKey(media)) ?? media.mediaListEntry?.status ?? undefined
  if (status === 'COMPLETED') return true
  if (status === 'REPEATING') return false
  const total = media.episodes ?? 0
  if (media.status !== 'FINISHED' || !(total > 0)) return false
  return (seriesEpisodesWatched(media, sources) ?? 0) >= total
}

/** Tracker-sourced Continue Watching entries by media id. */
export function trackerProgress(snapshot: readonly CwEntry[]): Map<number, number> {
  return new Map(snapshot.filter((entry) => entry.source === 'tracker').map((entry) => [entry.media.id, entry.progress]))
}

/** One pass over the local library, matching `localTrackingForMedia`: the newest entry with tracking
 *  per series, left out after an explicit removal that no later status undid. An entry counts when
 *  it has a status or a progress. */
export function localTrackingProgress(state: LocalLibraryState): Map<string, number> {
  const progress = new Map<string, number>()
  for (const [key, entry] of currentTracking(state)) progress.set(key, entry.progress ?? 0)
  return progress
}

/** The status of the same tracking entries, where they have one. */
export function localTrackingStatuses(state: LocalLibraryState): Map<string, string> {
  const statuses = new Map<string, string>()
  for (const [key, entry] of currentTracking(state)) if (entry.status) statuses.set(key, entry.status)
  return statuses
}

/** The newest tracking per series that still counts (see `localTrackingProgress`). */
function currentTracking(state: LocalLibraryState): Map<string, { status?: string; progress?: number }> {
  const newest = new Map<string, { at: number; status?: string; progress?: number }>()
  const statusAt = new Map<string, number>()
  for (const entry of Object.values(state.entries ?? {})) {
    if (!entry.tracking) continue
    const key = localTrackingKey(entry.media)
    if (entry.tracking.status) statusAt.set(key, Math.max(statusAt.get(key) ?? -Infinity, entry.updatedAt))
    const current = newest.get(key)
    if (!current || entry.updatedAt > current.at) newest.set(key, { at: entry.updatedAt, status: entry.tracking.status, progress: entry.tracking.progress })
  }
  const current = new Map<string, { status?: string; progress?: number }>()
  for (const [key, entry] of newest) {
    const removedAt = state.removedTracking?.[key]
    if (removedAt != null && !((statusAt.get(key) ?? -Infinity) > removedAt)) continue
    if (entry.status || entry.progress != null) current.set(key, { status: entry.status, progress: entry.progress })
  }
  return current
}

/** The live sources, read once per store change for every card. */
const progressSources: Readable<SeriesProgressSources> = derived(
  [cwSnapshot, localLibrary, localHistory, sessionProgress, manualProgressOverrides],
  ([$snapshot, $library, $history, $session, $overrides]) => ({
    tracker: trackerProgress($snapshot),
    tracking: localTrackingProgress($library),
    statuses: localTrackingStatuses($library),
    history: $history,
    session: $session,
    overrides: $overrides,
  }),
)

/** `episodesWatched` for any series from the live stores. Cards read it only while a theme template
 *  renders them, so izumi's own cards never subscribe. */
export const seriesProgress: Readable<(media: Media) => number | undefined> = derived(
  progressSources, (sources) => (media: Media) => seriesEpisodesWatched(media, sources),
)

/** `completed` for any series from the same live stores (Theme API 4). */
export const seriesCompletion: Readable<(media: Media) => boolean> = derived(
  progressSources, (sources) => (media: Media) => seriesCompleted(media, sources),
)
