import { describe, expect, it, vi } from 'vitest'
import { chainNeighbours, fetchSeasonChain, mayListSeasons, seasonEntries, walkSeasonChain } from './seasons'
import type { Media } from './types'

// fetchSeasonChain's AniList requests, answered per test.
const query = vi.hoisted(() => vi.fn())
vi.mock('./client', () => ({ anilist: { query } }))

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
  it('ends on a prequel/sequel cycle, asking for each title once', async () => {
    const cycle: Record<number, Media> = {
      21: node(21, 'TV', 2019, [['SEQUEL', 22], ['PREQUEL', 23]]),
      22: node(22, 'TV', 2020, [['PREQUEL', 21], ['SEQUEL', 23]]),
      23: node(23, 'TV', 2021, [['PREQUEL', 22], ['SEQUEL', 21]]),
    }
    const fetchMedia = fetchFrom(cycle)
    const chain = await walkSeasonChain({ id: 21, title: {} } as Media, fetchMedia)
    expect(chain.map((media) => media.id).sort()).toEqual([21, 22, 23])
    expect(fetchMedia.mock.calls.flat().flat().sort()).toEqual([21, 22, 23])
  })
  it('stops after 12 requests on a very long chain', async () => {
    const long: Record<number, Media> = Object.fromEntries(Array.from({ length: 30 }, (_, index) => {
      const id = 100 + index
      return [id, node(id, 'TV', 1990 + index, [['PREQUEL', id - 1], ['SEQUEL', id + 1]])]
    }))
    const fetchMedia = fetchFrom(long)
    await walkSeasonChain({ id: 100, title: {} } as Media, fetchMedia)
    expect(fetchMedia).toHaveBeenCalledTimes(12)
  })
})

describe('season formats', () => {
  it('walks the chain only for titles that can be a season', () => {
    for (const format of ['TV', 'TV_SHORT', 'ONA']) expect(mayListSeasons(format), format).toBe(true)
    for (const format of ['MOVIE', 'OVA', 'SPECIAL', 'MUSIC']) expect(mayListSeasons(format), format).toBe(false)
    // Some providers carry no format: the title's AniList record decides.
    expect(mayListSeasons(undefined)).toBe(true)
    expect(mayListSeasons(null)).toBe(true)
  })
})

describe('season chain cache', () => {
  const answer = (result: object) => ({ toPromise: async () => result })
  it('forgets a failed walk, so the next visit asks again', async () => {
    query.mockReset()
    query.mockReturnValueOnce(answer({ error: { message: 'Too Many Requests' } }))
    await expect(fetchSeasonChain(501)).rejects.toThrow('Too Many Requests')
    query.mockReturnValueOnce(answer({ data: { Page: { media: [node(501, 'TV', 2020)] } } }))
    expect((await fetchSeasonChain(501)).map((media) => media.id)).toEqual([501])
    expect(query).toHaveBeenCalledTimes(2)
    // A walk that worked is kept.
    await fetchSeasonChain(501)
    expect(query).toHaveBeenCalledTimes(2)
  })
  it('asks for every season banner, so picking one opens its page with the real header art', async () => {
    query.mockReset()
    query.mockReturnValueOnce(answer({ data: { Page: { media: [node(601, 'TV', 2020)] } } }))
    await fetchSeasonChain(601)
    const body: string = query.mock.calls[0][0].loc.source.body
    // Once on the fetched seasons and once on their prequel/sequel nodes.
    expect(body.match(/\bbannerImage\b/g)).toHaveLength(2)
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
