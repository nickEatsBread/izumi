import type { Media } from '$lib/anilist/types'
import { negativeHashId } from '$lib/catalog/identity'
import { describe, type Stream } from '$lib/stremio/parse'
import type { SearchEpisode } from './episode'

/** A season pack, by the source's own flag or by the release name. */
export function isPackRelease(stream: Stream): boolean {
  return !!stream.__batch || describe(stream).batch === true
}

/** A stand-in title for one release picked in search box mode, so the existing player path
 *  (P2P, debrid, Android, recovery) plays it unchanged. */
export function releaseMedia(stream: Stream, want?: SearchEpisode): Media {
  const name = stream.behaviorHints?.filename ?? stream.title?.split('\n')[0] ?? 'Release'
  const pack = isPackRelease(stream)
  return {
    id: negativeHashId(`release:${(stream.infoHash ?? '').toLowerCase()}`),
    type: pack ? 'SERIES' : 'MOVIE',
    format: pack ? 'TV' : 'MOVIE',
    title: { romaji: name, userPreferred: name },
    release: { stream, pack, season: want?.season },
  }
}

export const isReleaseMedia = (media: Pick<Media, 'release'> | null | undefined): boolean => !!media?.release
