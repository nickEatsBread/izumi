import { gql } from '@urql/core'
import { MEDIA_FIELDS } from './fragments'
import type { Media } from './types'

export const LIST_QUERY = gql`
  query Lists($userName: String!, $status: MediaListStatus) {
    MediaListCollection(userName: $userName, type: ANIME, status: $status, sort: UPDATED_TIME_DESC) {
      lists { entries { progress media { ...MediaFields } } }
    }
  }
  ${MEDIA_FIELDS}`

export interface Entry { media: Media; progress: number }
interface Coll { MediaListCollection?: { lists?: { entries?: Entry[] }[] } }
export function flattenEntries(data: Coll | undefined): Entry[] {
  return (data?.MediaListCollection?.lists ?? []).flatMap((l) => l.entries ?? [])
}
