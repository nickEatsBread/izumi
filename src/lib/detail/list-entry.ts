import type { AniStatus } from '$lib/trackers'
import { mergedProgress } from '$lib/trackers/status'

/** The list editor's optimistic patch, applied the moment it saves. */
export interface ListEdit { status?: AniStatus; progress?: number; score?: number; removed?: boolean }

/** One read of the viewer's list entry: local tracking, the AniList entry, or the other trackers. */
export interface ListEntryRead { status?: string; progress?: number; score?: number }

export interface SeriesListInputs {
  edit: ListEdit
  local?: ListEntryRead | null
  anilist?: ListEntryRead | null
  external?: ListEntryRead | null
  /** The viewer removed the title on this device. */
  locallyRemoved?: boolean
  /** Exact progress chosen from the episode tools. */
  override?: number
  /** Episodes this device has recorded as watched (`recordedWatched`). */
  watched: number
  /** `watched` when the page read its sources or last saved an edit; null until it has. */
  watchedBefore: number | null
}

export interface SeriesListEntry {
  /** The edit still in force. An episode watched after it leaves only its score. */
  edit: ListEdit
  removed: boolean
  status?: AniStatus
  progress: number
  score100: number
}

/** The list status, episode count and score the series page shows and the list editor opens with.
 *
 * The page stays mounted, hidden, while the player is up, so its tracker reads and the editor's
 * optimistic patch all predate any episode watched there. An episode this device records after the
 * page read its sources (or saved an edit) is newer than all of them: the count moves up to it and
 * the edit's status, count and removal give way to the entry that watch wrote. Until then an explicit
 * edit wins outright, so a deliberate rewind is not undone by a stale tracker read. */
export function seriesListEntry(input: SeriesListInputs): SeriesListEntry {
  const watchedSince = input.watchedBefore != null && input.watched > input.watchedBefore
  const edit: ListEdit = !watchedSince ? input.edit : input.edit.score == null ? {} : { score: input.edit.score }
  const removed = !!edit.removed || !!input.locallyRemoved
  if (removed) return { edit, removed, progress: 0, score100: 0 }
  const { local, anilist, external } = input
  // Take the furthest tracker rather than the first: an AniList entry at 0 is a real value and must
  // not hide the progress a MAL-first viewer has elsewhere.
  const tracked = mergedProgress(local?.progress, anilist?.progress, external?.progress)
  return {
    edit,
    removed,
    status: edit.status ?? (local?.status ?? anilist?.status ?? external?.status) as AniStatus | undefined,
    progress: edit.progress ?? input.override ?? Math.max(tracked, watchedSince ? input.watched : 0),
    score100: edit.score ?? local?.score ?? anilist?.score ?? external?.score ?? 0,
  }
}
