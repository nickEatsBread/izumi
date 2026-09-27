// A title's seasons: the AniList prequel/sequel chain around it, for the season picker above the
// episodes (API 3 `detail.episodes.seasons`).
import { gql } from '@urql/core'
import { anilist } from './client'
import { sortFranchiseMedia } from './franchise'
import type { Media } from './types'

/** Formats that count as a season. Films, OVAs and specials stay in Relations. */
export const SEASON_FORMATS: ReadonlySet<string> = new Set(['TV', 'TV_SHORT', 'ONA'])
const CHAIN_RELATIONS = new Set(['PREQUEL', 'SEQUEL'])
const MAX_WAVES = 12
const MAX_TITLES = 60

const SEASON_CHAIN_QUERY = gql`
  query SeasonChain($ids: [Int]) {
    Page(page: 1, perPage: 50) {
      media(id_in: $ids, type: ANIME) {
        id type format season seasonYear
        title { romaji english native userPreferred }
        startDate { year month day }
        coverImage { extraLarge large medium color }
        relations {
          edges {
            relationType
            node {
              id type format season seasonYear
              title { romaji english native userPreferred }
              startDate { year month day }
              coverImage { extraLarge large medium color }
            }
          }
        }
      }
    }
  }`

/** The titles this record links to as prequel or sequel (anime only). */
export function chainNeighbours(media: Media): Media[] {
  return (media.relations?.edges ?? [])
    .filter((edge) => CHAIN_RELATIONS.has(edge.relationType) && edge.node.type !== 'MANGA')
    .map((edge) => edge.node)
}

export type FetchMedia = (ids: number[]) => Promise<Media[]>

/** Walk only the prequel/sequel chain from `root`. Every format is followed (a film between two
 *  seasons links them); each wave asks for the whole frontier in one request. A root that already
 *  carries its relations (the detail page's record) is not fetched again. */
export async function walkSeasonChain(root: Media, fetchMedia: FetchMedia, maxWaves = MAX_WAVES): Promise<Media[]> {
  const found = new Map<number, Media>([[root.id, root]])
  const expanded = new Set<number>()
  let frontier: number[] = [root.id]
  if (root.relations) {
    expanded.add(root.id)
    frontier = []
    for (const neighbour of chainNeighbours(root)) {
      if (!found.has(neighbour.id)) found.set(neighbour.id, neighbour)
      frontier.push(neighbour.id)
    }
  }
  for (let wave = 0; wave < maxWaves && frontier.length && found.size < MAX_TITLES; wave++) {
    const ids = [...new Set(frontier)].filter((id) => !expanded.has(id)).slice(0, 50)
    if (!ids.length) break
    for (const id of ids) expanded.add(id)
    const next: number[] = []
    for (const media of await fetchMedia(ids)) {
      found.set(media.id, media)
      for (const neighbour of chainNeighbours(media)) {
        if (!found.has(neighbour.id) && found.size < MAX_TITLES) found.set(neighbour.id, neighbour)
        if (!expanded.has(neighbour.id)) next.push(neighbour.id)
      }
    }
    frontier = next
  }
  return [...found.values()]
}

export interface SeasonEntry {
  media: Media
  /** "Season 2", by position in release order. */
  label: string
  year?: number
  /** The title being viewed. */
  active: boolean
}

/** The chain's seasons in release order, labelled by position. Empty unless there are two or more
 *  and `currentId` is one of them (a film's page gets no season picker). */
export function seasonEntries(chain: Media[], currentId: number): SeasonEntry[] {
  const seasons = sortFranchiseMedia(chain.filter((media) => SEASON_FORMATS.has(media.format ?? '')))
  if (seasons.length < 2 || !seasons.some((media) => media.id === currentId)) return []
  return seasons.map((media, index) => ({
    media,
    label: `Season ${index + 1}`,
    year: media.seasonYear ?? media.startDate?.year ?? undefined,
    active: media.id === currentId,
  }))
}

const chains = new Map<number, Promise<Media[]>>()

/** The chain around an AniList id, cached for the session under every member's id, so moving
 *  between seasons reuses one walk. `seed` is the already-loaded record of `rootId`. */
export function fetchSeasonChain(rootId: number, seed?: Media): Promise<Media[]> {
  const cached = chains.get(rootId)
  if (cached) return cached
  const root: Media = seed?.id === rootId ? seed : ({ id: rootId, title: {} } as Media)
  const request = walkSeasonChain(root, async (ids) => {
    const result = await anilist.query(SEASON_CHAIN_QUERY, { ids }).toPromise()
    if (result.error) throw new Error(result.error.message)
    return (result.data?.Page?.media ?? []) as Media[]
  })
  chains.set(rootId, request)
  request.then(
    (chain) => { for (const media of chain) if (!chains.has(media.id)) chains.set(media.id, request) },
    () => { chains.delete(rootId) },
  )
  return request
}
