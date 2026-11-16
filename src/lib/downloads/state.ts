import { persisted } from 'svelte-persisted-store'
import { writable, get } from 'svelte/store'
import type { Media } from '$lib/anilist/types'
import type { Stream } from '$lib/stremio/parse'
import type { ContinueHint } from '$lib/stremio/play'

// Downloads data + read accessors ONLY (no play.ts import) so play.ts can check for
// a local file without a circular import. The queue/actions live in store.ts.

export type DlStatus = 'queued' | 'downloading' | 'paused' | 'done' | 'error'
export interface DownloadPreferences {
  quality?: '2160' | '1080' | '720' | '480' | 'any'
  cachedOnly?: boolean
  audio?: 'any' | 'sub' | 'dub'
  codec?: 'any' | 'h264' | 'h265' | 'av1'
  /** Internal: reacquire a temporary DRM license from the same source as the saved media. */
  sourceOriginId?: string
  /** The release the user chose for the first episode of a multi-episode download; the others
   *  follow it (its pack, release group or source) the way a binge does. */
  release?: ContinueHint
}
export interface DownloadItem {
  id: string
  mediaId: number
  episode: number
  title: string
  poster?: string
  filename?: string
  path?: string
  url?: string
  /** Which engine is fetching this item. Absent on items queued by older builds, which were all
   *  HTTP (debrid) downloads — pause/cancel must keep routing those to the HTTP job.
   *  `drm-local`: a protected episode saved by izumi's own Widevine module: `path` is its folder of
   *  clear files. `drm`: protected segments decrypted with a bundled device into one clear local
   *  file. Neither needs a CDM or a licence at playback. */
  kind?: 'http' | 'torrent' | 'shaka' | 'drm-local' | 'drm'
  /** Shaka's IndexedDB manifest URI for adaptive/DRM offline playback. */
  offlineUri?: string
  drmKeySystem?: string
  requiresOnlineLicense?: boolean
  sourceOriginId?: string
  infoHash?: string
  provider?: string
  quality?: string
  bytes: number // total size
  downloaded: number
  status: DlStatus
  error?: string
  addedAt: number
  completedAt?: number
  preferences?: DownloadPreferences
  ruleId?: string
  /** The stream this download saves: the one the user chose, else the one its first run picked.
   *  A resume, retry or restart fetches it again, so the partial data on disk stays one file. */
  source?: Stream
}

/** Persisted map keyed by `<mediaId>:<episode>`. */
export const downloads = persisted<Record<string, DownloadItem>>('downloads', {})
/** Live download speed (bytes/s) by id — not persisted. */
export const speeds = writable<Record<string, number>>({})

/** Series info snapshot per downloaded mediaId, persisted so the Downloads page +
 *  OFFLINE playback have title/cover/episode-count/ids without a network fetch. */
export const downloadedMedia = persisted<Record<number, Media>>('downloaded-media', {})
export const getDownloadedMedia = (mediaId: number): Media | undefined => get(downloadedMedia)[mediaId]
export function setDownloadedMedia(m: Media) {
  // Store only the fields offline playback + the downloads UI need (keeps localStorage
  // small — drops relations/description/etc).
  const lite = {
    id: m.id, idMal: m.idMal, title: m.title, format: m.format, status: m.status,
    episodes: m.episodes, duration: m.duration, averageScore: m.averageScore, genres: m.genres,
    startDate: m.startDate, coverImage: m.coverImage, bannerImage: m.bannerImage,
    nextAiringEpisode: m.nextAiringEpisode, season: m.season, seasonYear: m.seasonYear,
    // Source matching uses alternate titles and the main studio. Persist them so starting or
    // resuming a download never has to refetch AniList merely to rediscover data we already had.
    synonyms: m.synonyms, studios: m.studios,
    // Keep the airing schedule: OVA/ONA/adult titles have episodes + nextAiringEpisode both null,
    // and their ONLY episode-count signal is airingSchedule.nodes. Without it totalEpisodes()=0
    // OFFLINE → the detail page shows "Episodes TBA" with zero rows even for downloaded episodes
    // (the exact bug offline mode exists to fix). Mirrors mediaSnapshot() in player/history.ts.
    airingSchedule: m.airingSchedule,
    // A catalog title (a source's own, say) is found again by its catalog identity and its episodes'
    // ids: its negative id is a hash no metadata service can look up.
    catalog: m.catalog,
    videos: m.videos?.map(({ id, number, season, episode, title, thumbnail }) => ({ id, number, season, episode, title, thumbnail })),
  } as Media
  downloadedMedia.update((d) => ({ ...d, [m.id]: lite }))
}

export const keyFor = (mediaId: number, ep: number | undefined) => `${mediaId}:${ep ?? 0}`
export const downloadOf = (mediaId: number, ep: number | undefined): DownloadItem | undefined =>
  get(downloads)[keyFor(mediaId, ep)]
export const hasDownload = (mediaId: number, ep: number | undefined) =>
  downloadOf(mediaId, ep)?.status === 'done'

export function setItem(id: string, p: Partial<DownloadItem>) {
  downloads.update((d) => (d[id] ? { ...d, [id]: { ...d[id], ...p } } : d))
}
export function removeItem(id: string) {
  downloads.update((d) => { const n = { ...d }; delete n[id]; return n })
}
export function setSpeed(id: string, v: number | undefined) {
  speeds.update((s) => { const n = { ...s }; if (v == null) delete n[id]; else n[id] = v; return n })
}
