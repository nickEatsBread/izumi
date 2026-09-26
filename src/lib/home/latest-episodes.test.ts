import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('$lib/anilist/client', () => ({ anilist: { query: (...args: unknown[]) => ({ toPromise: () => query(...args) }) } }))
const { loadLatestEpisodes, releaseStill, appendReleases, releaseKey, isFinale } = await import('./latest-episodes')
const { showAdult } = await import('$lib/settings/ui')

const release = (id: number, episode: number, isAdult = false) => ({ episode, airingAt: 1_000 + id, media: { id, isAdult, title: { romaji: `T${id}` }, coverImage: { extraLarge: `c${id}` }, bannerImage: id === 1 ? 'b1' : null } })

describe('latest episodes', () => {
  beforeEach(() => {
    query.mockReset()
    showAdult.set(false)
  })

  it('pages the airing schedule backwards from a fixed moment and hides adult titles', async () => {
    query.mockResolvedValue({ data: { Page: { pageInfo: { hasNextPage: true, lastPage: 40 }, airingSchedules: [release(1, 3), release(2, 7, true), { episode: 1, airingAt: 5, media: null }] } } })
    const page = await loadLatestEpisodes(2, 12, 1_700_000_000)
    expect(page.items.map((item) => [item.media.id, item.episode])).toEqual([[1, 3]])
    expect(page).toMatchObject({ hasNextPage: true, lastPage: 40 })
    expect(query.mock.calls[0][1]).toMatchObject({ page: 2, perPage: 12, before: 1_700_000_000 })
  })

  it('keeps adult titles when the setting allows them', async () => {
    showAdult.set(true)
    query.mockResolvedValue({ data: { Page: { pageInfo: { hasNextPage: false }, airingSchedules: [release(2, 7, true)] } } })
    expect((await loadLatestEpisodes(1, 12, 1)).items).toHaveLength(1)
  })

  it('surfaces errors', async () => {
    query.mockResolvedValue({ error: new Error('down') })
    await expect(loadLatestEpisodes(1, 12, 1)).rejects.toThrow('down')
  })

  it('prefers the episode still, then the banner, then the cover', () => {
    expect(releaseStill(release(1, 3) as never, 'still.jpg')).toBe('still.jpg')
    expect(releaseStill(release(1, 3) as never)).toBe('b1')
    expect(releaseStill(release(2, 3) as never)).toBe('c2')
  })

  it('keys releases by title, episode and air time, and appends without repeats', () => {
    expect(releaseKey(release(1, 3) as never)).toBe('1-3-1001')
    expect(appendReleases([release(1, 3)] as never, [release(1, 3), release(2, 4)] as never).map(releaseKey)).toEqual(['1-3-1001', '2-4-1002'])
  })

  it('flags an episode as the finale only when it reaches the known episode count', () => {
    expect(isFinale({ episode: 12, media: { episodes: 12 } } as never)).toBe(true)
    expect(isFinale({ episode: 11, media: { episodes: 12 } } as never)).toBe(false)
    expect(isFinale({ episode: 3, media: { episodes: null } } as never)).toBe(false)
  })
})
