import { describe, expect, it, vi } from 'vitest'
import { chainNeighbours, seasonEntries, walkSeasonChain } from './seasons'
import type { Media } from './types'

type Edge = [relation: string, id: number]
function node(id: number, format: string, year: number, edges: Edge[] = []): Media {
  return {
    id, type: 'ANIME', format, seasonYear: year, startDate: { year, month: 1, day: 1 },
    title: { userPreferred: `Title ${id}` },
    relations: { edges: edges.map(([relationType, target]) => ({ relationType, node: { id: target, type: 'ANIME', title: { userPreferred: `Title ${target}` } } as Media })) },
  } as Media
}
// Season 1 (TV) → a film → Season 2 (TV) → Season 3 (ONA); a side story hangs off season 1.
const graph: Record<number, Media> = {
  1: node(1, 'TV', 2019, [['SEQUEL', 2], ['SIDE_STORY', 9]]),
  2: node(2, 'MOVIE', 2020, [['PREQUEL', 1], ['SEQUEL', 3]]),
  3: node(3, 'TV', 2021, [['PREQUEL', 2], ['SEQUEL', 4]]),
  4: node(4, 'ONA', 2023, [['PREQUEL', 3]]),
  9: node(9, 'TV', 2020, [['PARENT', 1]]),
}
const fetchFrom = (source: Record<number, Media>) => vi.fn(async (ids: number[]) => ids.map((id) => source[id]).filter(Boolean))

describe('season chain', () => {
  it('follows prequel and sequel links only, through a film', async () => {
    const fetchMedia = fetchFrom(graph)
    const chain = await walkSeasonChain(graph[3], fetchMedia)
    expect(chain.map((media) => media.id).sort()).toEqual([1, 2, 3, 4])
    expect(fetchMedia.mock.calls.flat().flat()).not.toContain(9)
  })
  it('starts from a bare id when the root has no relations loaded', async () => {
    const fetchMedia = fetchFrom(graph)
    const chain = await walkSeasonChain({ id: 1, title: {} } as Media, fetchMedia)
    expect(chain.map((media) => media.id).sort()).toEqual([1, 2, 3, 4])
    expect(fetchMedia.mock.calls[0][0]).toEqual([1])
  })
  it('lists only the neighbours linked as prequel or sequel', () => {
    expect(chainNeighbours(graph[1]).map((media) => media.id)).toEqual([2])
  })
})

describe('season entries', () => {
  const chain = [graph[4], graph[2], graph[1], graph[3]]
  it('labels TV, TV short and ONA entries by release order', () => {
    expect(seasonEntries(chain, 3).map((entry) => [entry.label, entry.media.id, entry.year, entry.active])).toEqual([
      ['Season 1', 1, 2019, false],
      ['Season 2', 3, 2021, true],
      ['Season 3', 4, 2023, false],
    ])
  })
  it('stays empty for one season, or when this title is not one of them', () => {
    expect(seasonEntries([graph[1], graph[2]], 1)).toEqual([])
    expect(seasonEntries(chain, 2)).toEqual([])
  })
})
