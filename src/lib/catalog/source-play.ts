/** Playing a source catalog's own title straight from a card or the banner, as the source's own app does. */
import { get } from 'svelte/store'
import type { Media, MediaVideo } from '$lib/anilist/types'
import { banner, cover, title } from '$lib/anilist/media'
import { connecting } from '$lib/player/session'
import { takePrefetchedDetail } from './detail-prefetch'
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

/** Opens a source title's details and plays its episode. False when the source has nothing to play.
 *  The connecting screen goes up with the press: reading the details took 0.5-1.8 s on the Steam
 *  Deck, with nothing on screen meanwhile (the banner's Play showed no feedback at all). playEpisode
 *  then puts up the same screen with its own cancel. */
export async function playSourceTitle(media: Media, videoId?: string): Promise<boolean> {
  if (!media.catalog) return false
  let cancelled = false
  const pending = { title: title(media), art: banner(media) || cover(media), media, cancel: () => { cancelled = true; connecting.set(null) } }
  connecting.set(pending)
  const release = () => { if (get(connecting) === pending) connecting.set(null) }
  try {
    const ref = mediaRef(media)
    const detail = await (takePrefetchedDetail(ref) ?? loadCatalogProvider('stremio').then((provider) => provider.detail(ref)))
    const target = detail && sourcePlayTarget(detail, videoId)
    if (cancelled) return true
    if (!detail || !target) { release(); return false }
    const movie = detail.catalog?.type === 'movie' || detail.format === 'MOVIE'
    const { playEpisode } = await import('$lib/stremio/play')
    if (cancelled) return true
    // The source picker reports its own failures.
    await playEpisode(detail, movie ? undefined : target.video.number, () => {}, target.startSeconds ? { startSeconds: target.startSeconds } : {})
    // A play refused before it began (a profile's limits) leaves the stand-in up.
    release()
    return true
  } catch (error) {
    release()
    throw error
  }
}
