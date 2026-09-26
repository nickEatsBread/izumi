import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('$lib/anilist/client', () => ({ anilist: { query: (...args: unknown[]) => ({ toPromise: () => query(...args) }) } }))
const { loadAniListProfile, localProfile } = await import('./profile')

describe('profile header data', () => {
  beforeEach(() => query.mockReset())

  it('reads a public AniList profile', async () => {
    query.mockResolvedValue({ data: { User: { name: 'mika', avatar: { large: 'a.png' }, bannerImage: 'b.png', statistics: { anime: { count: 42, episodesWatched: 900 } } } } })
    expect(await loadAniListProfile('mika')).toEqual({ name: 'mika', avatar: 'a.png', banner: 'b.png', episodes: 900, titles: 42, source: 'anilist' })
    expect(query.mock.calls[0][1]).toEqual({ name: 'mika' })
  })

  it('returns null when the user cannot be read', async () => {
    query.mockResolvedValue({ error: new Error('404') })
    expect(await loadAniListProfile('ghost')).toBeNull()
  })

  it('summarises local history when no tracker is connected', () => {
    const entry = (id: number, episode: number, updatedAt: number, bannerImage?: string) => ({ media: { id, bannerImage, coverImage: { extraLarge: `c${id}` } }, episode, progress: 0, updatedAt })
    expect(localProfile({ 1: entry(1, 12, 5, 'old') as never, 2: entry(2, 3, 9) as never })).toEqual({ name: 'You', banner: 'c2', episodes: 15, titles: 2, source: 'local' })
    expect(localProfile({})).toEqual({ name: 'You', episodes: 0, titles: 0, source: 'local' })
  })
})
