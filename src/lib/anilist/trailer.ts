import { gql } from '@urql/core'
import type { Media } from './types'

/** A title's trailer and nothing else, for a card whose data came without it. */
export const MEDIA_TRAILER_QUERY = gql`
  query MediaTrailer($id: Int) {
    Media(id: $id, type: ANIME) { id trailer { id site } }
  }`

/** An AniList anime whose trailer was never asked for. A MyAnimeList list row maps MAL's own data,
 *  which has no trailer, so its hover preview could only ever show the still. `null` means AniList
 *  has none; a catalog title (TMDB, an add-on, a source) carries its own. */
export function lacksTrailerField(media: Pick<Media, 'id' | 'type' | 'trailer' | 'catalog'>): boolean {
  return media.trailer === undefined && media.type === 'ANIME' && !media.catalog && Number.isInteger(media.id) && media.id > 0
}
