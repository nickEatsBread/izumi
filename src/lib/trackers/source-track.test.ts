import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  aniMutation: vi.fn(),
  fetchMediaById: vi.fn(),
}))

vi.mock('$lib/anilist/client', () => ({ anilist: { mutation: mocks.aniMutation } }))
vi.mock('$lib/anilist/fetch-media', () => ({ fetchMediaById: mocks.fetchMediaById }))

import { incognito } from '$lib/stores/incognito'
import { durableHistory, sessionProgress } from '$lib/player/history'
import { saveLocalHistory } from '$lib/settings/ui'
import { anilistToken, malToken } from './config'
import { trackerQueue } from './queue'
import { WATCHLIST_ID, localLibrary } from '$lib/library/local-lists'
import { markWatched } from './index'
import type { Media } from '$lib/anilist/types'

// A source catalog's own title (a negative id, no tracker identity) whose source names the AniList
// entry each episode is: its second season's first episode is the 14th episode of the series here.
const sourceTitle = (): Media => ({
  id: -42,
  type: 'ANIME',
  format: 'TV',
  title: { romaji: 'Some Series' },
  catalog: { provider: 'stremio', type: 'series', id: 'source:cr:1' },
  videos: [
    { number: 13, season: 1, episode: 13, track: { anilist: 700, mal: 7700, episode: 13 } },
    { number: 14, season: 2, episode: 1, track: { anilist: 701, mal: 7701, episode: 1 } },
  ],
} as unknown as Media)
const seasonTwo = { id: 701, idMal: 7701, type: 'ANIME', format: 'TV', episodes: 12, title: { romaji: 'Some Series Season 2' } } as unknown as Media

describe('a source title tracked on the AniList entry its source names', () => {
  beforeEach(() => {
    mocks.aniMutation.mockReset()
    mocks.aniMutation.mockReturnValue({ toPromise: async () => ({ data: {} }) })
    mocks.fetchMediaById.mockReset()
    mocks.fetchMediaById.mockResolvedValue(seasonTwo)
    anilistToken.set('ani-token')
    malToken.set(null)
    saveLocalHistory.set(true)
    incognito.set(false)
    durableHistory.set({})
    sessionProgress.set({})
    trackerQueue.set([])
    localLibrary.set({ lists: [{ id: WATCHLIST_ID, name: 'Watchlist', createdAt: 0 }], entries: {}, queue: [] })
  })
  afterEach(() => { anilistToken.set(null) })

  it('tracks the watched episode as that entry\'s own episode', async () => {
    markWatched(sourceTitle(), 14)
    await vi.waitFor(() => expect(mocks.aniMutation).toHaveBeenCalled())
    expect(mocks.fetchMediaById).toHaveBeenCalledWith(701)
    expect(mocks.aniMutation.mock.calls.at(-1)![1]).toMatchObject({ mediaId: 701, progress: 1 })
  })

  it('tracks nothing for an episode the source did not place', async () => {
    const title = sourceTitle()
    title.videos = title.videos!.map((video) => ({ ...video, track: undefined }))
    markWatched(title, 14)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(mocks.fetchMediaById).not.toHaveBeenCalled()
  })
})
