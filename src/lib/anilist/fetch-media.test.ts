import { beforeEach, describe, expect, it, vi } from 'vitest'

const { query } = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('./client', () => ({ anilist: { query } }))

import { fetchMediaById, SOURCE_MEDIA_BY_ID } from './fetch-media'

describe('fetchMediaById', () => {
  beforeEach(() => query.mockReset())

  it('refreshes the source-resolution fields omitted by persisted history snapshots', async () => {
    const media = { id: 987654, title: { userPreferred: 'Fresh title' }, synonyms: ['Alias'] }
    query.mockReturnValue({ toPromise: async () => ({ data: { Media: media } }) })

    await expect(fetchMediaById(media.id)).resolves.toBe(media)

    const [document, variables] = query.mock.calls[0]
    expect(document).toBe(SOURCE_MEDIA_BY_ID)
    expect(variables.id).toBe(media.id)
    const body = (SOURCE_MEDIA_BY_ID.loc?.source.body ?? '').replace(/\s+/g, ' ')
    expect(body).toContain('season seasonYear')
    expect(body).toContain('genres synonyms')
    expect(body).toContain('averageScore popularity trending')
    expect(body).toMatch(/startDate\s*\{\s*year month day/)
    expect(body).toMatch(/studios\(isMain:\s*true\)/)
    expect(body).toMatch(/relations\s*\{\s*edges\s*\{\s*relationType\s+node/)
    expect((body.match(/\{/g) ?? []).length).toBe((body.match(/\}/g) ?? []).length)
  })

  it('asks for the media type of every relation so reading titles can be told apart', () => {
    // Without it, a manga/light-novel relation is indistinguishable from an anime one and gets sent
    // to the anime detail route, where AniList answers `Not Found` for the id.
    query.mockReturnValue({ toPromise: async () => ({ data: { Media: { id: 1, title: {} } } }) })
    return fetchMediaById(1).then(() => {
      const source = (SOURCE_MEDIA_BY_ID.loc?.source.body ?? '').replace(/\s+/g, ' ')
      const marker = 'relations { edges { relationType node {'
      const node = source.slice(source.indexOf(marker) + marker.length)
      expect(node).toContain('type')
      expect(node).toContain('format')
    })
  })

  it('can bypass the session cache for automatic airing checks', async () => {
    const id = 987655
    const first = { id, title: { userPreferred: 'First' } }
    const second = { id, title: { userPreferred: 'Updated' } }
    query
      .mockReturnValueOnce({ toPromise: async () => ({ data: { Media: first } }) })
      .mockReturnValueOnce({ toPromise: async () => ({ data: { Media: second } }) })

    await expect(fetchMediaById(id)).resolves.toBe(first)
    await expect(fetchMediaById(id, true)).resolves.toBe(second)
    expect(query).toHaveBeenCalledTimes(2)
    expect(query.mock.calls[1][2]).toEqual({ requestPolicy: 'network-only' })
  })

  it('deduplicates concurrent reads for the same media id', async () => {
    const id = 987656
    let resolve!: (value: unknown) => void
    query.mockReturnValue({ toPromise: () => new Promise((done) => { resolve = done }) })

    const first = fetchMediaById(id)
    const same = fetchMediaById(id)
    expect(query).toHaveBeenCalledTimes(1)
    resolve({ data: { Media: { id, title: { userPreferred: 'One request' } } } })
    await expect(Promise.all([first, same])).resolves.toHaveLength(2)
  })
})
