import { persisted } from 'svelte-persisted-store'
import { writable, get } from 'svelte/store'
import type { Media } from '$lib/anilist/types'

// Downloads data + read accessors ONLY (no play.ts import) so play.ts can check for
// a local file without a circular import. The queue/actions live in store.ts.

export type DlStatus = 'queued' | 'downloading' | 'paused' | 'done' | 'error'
export interface DownloadItem {
  id: string
  mediaId: number
  episode: number
  title: string
  poster?: string
  filename?: string
  path?: string
  url?: string
  infoHash?: string
  provider?: string
  quality?: string
  bytes: number // total size
  downloaded: number
  status: DlStatus
  error?: string
  addedAt: number
  completedAt?: number
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
    nextAiringEpisode: m.nextAiringEpisode,
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
