/** Playing a source catalog's own title straight from a card or the banner, as the source's own app does. */
import type { Media, MediaVideo } from '$lib/anilist/types'
import { mediaRef } from './identity'
import { loadCatalogProvider } from './registry'

/** The episode to play and where to start it: `videoId` (else where the source says to resume, else the
 *  first episode), from the source's playhead unless that episode is finished. */
export function sourcePlayTarget(detail: Media, videoId?: string): { video: MediaVideo; startSeconds?: number } | undefined {
  const videos = detail.videos ?? []
  const upNext = detail.sourceFacts?.upNext
  const wanted = videoId ?? upNext?.videoId
  const video = videos.find((item) => item.id === wanted) ?? videos[0]
  if (!video) return undefined
  const playhead = upNext && video.id === upNext.videoId && upNext.playhead ? upNext.playhead : !video.watched ? video.playhead : undefined
  return { video, ...(playhead ? { startSeconds: playhead } : {}) }
}

/** Opens a source title's details and plays its episode. False when the source has nothing to play. */
export async function playSourceTitle(media: Media, videoId?: string): Promise<boolean> {
  if (!media.catalog) return false
  const provider = await loadCatalogProvider('stremio')
  const detail = await provider.detail(mediaRef(media))
  const target = detail && sourcePlayTarget(detail, videoId)
  if (!detail || !target) return false
  const movie = detail.catalog?.type === 'movie' || detail.format === 'MOVIE'
  const { playEpisode } = await import('$lib/stremio/play')
  // The source picker reports its own failures.
  await playEpisode(detail, movie ? undefined : target.video.number, () => {}, target.startSeconds ? { startSeconds: target.startSeconds } : {})
  return true
}
