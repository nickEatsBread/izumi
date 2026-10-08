// One press on an episode's download, shared by the episode's own download button (`episode.download`)
// and the series header's "Download E{n}" (`detail.buttons` `download`), so both do the same thing: an
// episode that is not downloading is queued with the Settings → Downloads defaults (the queue the
// list's download selection fills); one that is queued, downloading or saved opens the Downloads page,
// where it can be paused, cancelled or deleted. A press never plays the episode.
import { get } from 'svelte/store'
import { goto } from '$app/navigation'
import type { Media } from '$lib/anilist/types'
import { enqueue } from '$lib/downloads/store'
import type { DownloadItem, DownloadPreferences } from '$lib/downloads/state'
import { downloadAudio, downloadCachedOnly, downloadCodec, downloadQuality } from '$lib/settings/ui'
import { episodeDownloadAction, episodeDownloadState } from './episode-download'

/** The Settings → Downloads defaults a one-tap download uses. */
export const downloadDefaults = (): DownloadPreferences => ({
  quality: get(downloadQuality),
  cachedOnly: get(downloadCachedOnly),
  audio: get(downloadAudio),
  codec: get(downloadCodec),
})

/** Queue episode `ep` with the download defaults, or open Downloads once it is queued, downloading or
 *  saved (`item` is its download, if any). Returns what the press did. */
export function pressEpisodeDownload(media: Media, ep: number, item?: DownloadItem): 'queue' | 'manage' {
  const action = episodeDownloadAction(episodeDownloadState(item))
  if (action === 'queue') enqueue(media, ep, downloadDefaults())
  else void goto('/app/downloads')
  return action
}
