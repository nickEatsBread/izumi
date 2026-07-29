import { gql } from '@urql/core'
import { anilist } from './client'
import type { Media } from './types'

const FRANCHISE_QUERY = gql`
  query FranchiseRelations($ids: [Int]) {
    Page(page: 1, perPage: 50) {
      media(id_in: $ids, type: ANIME) {
        id idMal type
        title { romaji english native userPreferred }
        season seasonYear format status episodes averageScore
        startDate { year month day }
        coverImage { extraLarge medium color }
        relations {
          edges {
            relationType
            node {
              id idMal type
              title { romaji english native userPreferred }
              season seasonYear format status episodes averageScore
              startDate { year month day }
              coverImage { extraLarge medium color }
            }
          }
        }
      }
    }
  }`

const MAX_TITLES = 48
const MAX_WAVES = 4
const cache = new Map<number, Promise<Media[]>>()

const dateKey = (media: Media) =>
  (media.startDate?.year ?? media.seasonYear ?? 9999) * 10_000
  + (media.startDate?.month ?? 12) * 100
  + (media.startDate?.day ?? 31)

export function sortFranchiseMedia(items: Media[]): Media[] {
  return [...items].sort((left, right) =>
    dateKey(left) - dateKey(right)
    || (left.format === 'TV' ? -1 : 0) - (right.format === 'TV' ? -1 : 0)
    || left.id - right.id)
}

/** Follow AniList relation edges in bounded batches. Four graph waves are enough to walk even a
 * long seasonal chain while keeping this to a handful of rate-limited requests; unrelated graphs
 * are capped so a shared cinematic universe cannot turn one detail page into an unbounded crawl. */
export function fetchFranchise(rootId: number): Promise<Media[]> {
  const existing = cache.get(rootId)
  if (existing) return existing
  const request = (async () => {
    const found = new Map<number, Media>()
    const expanded = new Set<number>()
    let frontier = [rootId]
    for (let wave = 0; wave < MAX_WAVES && frontier.length && found.size < MAX_TITLES; wave++) {
      const ids = frontier.filter((id) => !expanded.has(id)).slice(0, 50)
      if (!ids.length) break
      const result = await anilist.query(FRANCHISE_QUERY, { ids }).toPromise()
      if (result.error) throw new Error(result.error.message)
      const rows = (result.data?.Page?.media ?? []) as Media[]
      const next: number[] = []
      for (const media of rows) {
        expanded.add(media.id)
        found.set(media.id, media)
        for (const edge of media.relations?.edges ?? []) {
          if (edge.node.type === 'MANGA') continue
          if (found.size < MAX_TITLES && !found.has(edge.node.id)) found.set(edge.node.id, edge.node)
          if (!expanded.has(edge.node.id)) next.push(edge.node.id)
        }
      }
      // Fetch relation objects themselves on the next wave so their own prequel/sequel edges become
      // visible while keeping their shallow card data available if the graph cap is reached.
      frontier = [...new Set(next)]
    }
    return sortFranchiseMedia([...found.values()])
  })()
  cache.set(rootId, request)
  void request.catch(() => cache.delete(rootId))
  return request
}
