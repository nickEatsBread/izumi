import type { DownloadItem } from './state'
import type { Media } from '$lib/anilist/types'

// Group completed downloads into a per-series library for the offline home. `downloads` is the
// SOURCE OF TRUTH for membership + minimum metadata (title/poster live on each DownloadItem);
// `downloadedMedia` only ENRICHES (it can be absent for downloads from older builds).

export interface DownloadedSeries {
  mediaId: number
  title: string
  poster?: string
  episodeCount: number // number of `done` downloads for this series
  media?: Media // enrichment snapshot when present
}

/** Strip a trailing " — E<n>" (or "- E<n>") episode suffix from a DownloadItem.title to recover
 *  the series title. Download titles are built as `<series> — E<n>` (downloads/store.ts). */
export function seriesTitle(itemTitle: string): string {
  return itemTitle.replace(/\s*[—-]\s*E\d+\s*$/i, '').trim()
}

const snapTitle = (m?: Media) =>
  m?.title?.userPreferred || m?.title?.english || m?.title?.romaji || undefined
const snapPoster = (m?: Media) => m?.coverImage?.extraLarge || m?.coverImage?.medium || undefined

/** Pure: group `done` downloads by series, most-episodes-first (then title). Deterministic. */
export function groupDownloads(
  downloads: Record<string, DownloadItem>,
  downloadedMedia: Record<number, Media>,
): DownloadedSeries[] {
  const byId = new Map<number, DownloadedSeries>()
  for (const it of Object.values(downloads)) {
    if (it.status !== 'done') continue
    let s = byId.get(it.mediaId)
    if (!s) {
      const snap = downloadedMedia[it.mediaId]
      s = {
        mediaId: it.mediaId,
        title: snapTitle(snap) ?? seriesTitle(it.title),
        poster: snapPoster(snap) ?? it.poster,
        episodeCount: 0,
        media: snap,
      }
      byId.set(it.mediaId, s)
    }
    s.episodeCount++
  }
  return [...byId.values()].sort(
    (a, b) => b.episodeCount - a.episodeCount || a.title.localeCompare(b.title),
  )
}
