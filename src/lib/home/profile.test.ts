import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('$lib/anilist/client', () => ({ anilist: { query: (...args: unknown[]) => ({ toPromise: () => query(...args) }) } }))
const { loadAniListProfile, localProfile, profileButtonArt } = await import('./profile')

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

describe('profile-header button art', () => {
  const show = (id: number, bannerImage?: string) => ({ id, bannerImage, coverImage: { extraLarge: `c${id}` } }) as never

  it('takes the viewer’s titles in order, Continue Watching first, never one twice', () => {
    expect(profileButtonArt([show(1, 'b1'), show(2)], [show(2, 'b2'), show(3, 'b3')], 3)).toEqual(['b1', 'c2', 'b3'])
    expect(profileButtonArt([show(1, 'b1')], [show(1, 'b1'), show(4, 'b4')], 2)).toEqual(['b1', 'b4'])
  })

  it('stops at the count and gives a button past the titles there are none', () => {
    expect(profileButtonArt([show(1, 'b1'), show(2, 'b2')], [], 1)).toEqual(['b1'])
    expect(profileButtonArt([show(1, 'b1')], [], 3)).toEqual(['b1'])
    expect(profileButtonArt([], [], 2)).toEqual([])
  })

  it('is the same for the same titles, render after render', () => {
    const watching = [show(5, 'b5'), show(6, 'b6')]
    const library = [show(7, 'b7')]
    expect(profileButtonArt(watching, library, 3)).toEqual(profileButtonArt([...watching], [...library], 3))
  })
})
