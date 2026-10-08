// The per-episode download button (API 4 `detail.episodes.download: "button"`): what it shows and
// what a press does, kept out of the component so both are testable. A press on an episode that is
// not downloading queues it with the Settings → Downloads defaults (the same queue the list's
// download selection fills); a press on one that is queued, downloading or saved opens the
// Downloads page, where it can be paused, cancelled or deleted. A press never plays the episode.
import type { DownloadItem } from '$lib/downloads/state'

/** `data-state` on `episode.download`. A paused download is still `progress`; a failed one is `none`
 *  again, so a press retries it. */
export type EpisodeDownloadState = 'none' | 'queued' | 'progress' | 'done'

type Item = Pick<DownloadItem, 'status' | 'bytes' | 'downloaded'>

export function episodeDownloadState(item?: Item): EpisodeDownloadState {
  if (!item || item.status === 'error') return 'none'
  if (item.status === 'done') return 'done'
  if (item.status === 'queued') return 'queued'
  return 'progress'
}

/** Whole percent downloaded (0–100): 100 once saved, 0 while the size is unknown. */
export function episodeDownloadPercent(item?: Item): number {
  if (!item || item.status === 'error') return 0
  if (item.status === 'done') return 100
  if (!item.bytes) return 0
  return Math.max(0, Math.min(100, Math.round((item.downloaded / item.bytes) * 100)))
}

/** What a press does: queue the episode, or open the Downloads page that manages it. */
export const episodeDownloadAction = (state: EpisodeDownloadState): 'queue' | 'manage' => (state === 'none' ? 'queue' : 'manage')

/** The button's accessible name and tooltip. `episode` is the number the list prints. */
export function episodeDownloadLabel(item: Item | undefined, episode: string): string {
  const state = episodeDownloadState(item)
  if (state === 'none') return item?.status === 'error' ? `Download episode ${episode} again` : `Download episode ${episode}`
  if (state === 'queued') return `Episode ${episode} is queued to download`
  if (state === 'done') return `Episode ${episode} is downloaded`
  const percent = episodeDownloadPercent(item)
  return item?.status === 'paused' ? `Episode ${episode} download paused at ${percent}%` : `Downloading episode ${episode}, ${percent}%`
}
