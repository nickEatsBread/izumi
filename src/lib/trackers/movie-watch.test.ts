import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  aniMutation: vi.fn(),
  malFetch: vi.fn(),
}))

vi.mock('$lib/anilist/client', () => ({
  anilist: { mutation: mocks.aniMutation },
}))

vi.mock('$lib/trackers/mal-auth', () => ({
  malFetch: mocks.malFetch,
}))

import { get } from 'svelte/store'
import { incognito } from '$lib/stores/incognito'
import { durableHistory, sessionProgress } from '$lib/player/history'
import { saveLocalHistory } from '$lib/settings/ui'
import { anilistToken, malToken } from './config'
import { trackerQueue } from './queue'
import { WATCHLIST_ID, localLibrary } from '$lib/library/local-lists'
import { markWatched } from './index'
import type { Media } from '$lib/anilist/types'

// A catalog film plays with NO episode number (playEpisode passes undefined); the watch threshold
// must resolve it to the movie's single episode instead of writing NaN/undefined into tracking.
const film = (): Media => ({
  id: 101,
  type: 'MOVIE',
  format: 'MOVIE',
  episodes: 1,
  title: { romaji: 'Some Film' },
  externalIds: { anilist: 55 },
} as unknown as Media)

const emptyLibrary = () => ({ lists: [{ id: WATCHLIST_ID, name: 'Watchlist', createdAt: 0 }], entries: {}, queue: [] })

describe('movie watch threshold', () => {
  beforeEach(() => {
    mocks.aniMutation.mockReset()
    mocks.malFetch.mockReset()
    mocks.aniMutation.mockReturnValue({ toPromise: async () => ({ data: {} }) })
    mocks.malFetch.mockResolvedValue(new Response('', { status: 200 }))
    anilistToken.set('ani-token')
    malToken.set(null)
    saveLocalHistory.set(true)
    incognito.set(false)
    durableHistory.set({})
    sessionProgress.set({})
    trackerQueue.set([])
    localLibrary.set(emptyLibrary())
  })

  afterEach(() => {
    incognito.set(false)
    anilistToken.set(null)
    malToken.set(null)
    durableHistory.set({})
    sessionProgress.set({})
    trackerQueue.set([])
    localLibrary.set(emptyLibrary())
  })

  it('resolves an undefined movie episode to a completed single-episode watch', async () => {
    markWatched(film(), undefined as unknown as number)

    const entry = get(durableHistory)[101]
    expect(entry?.progress).toBe(1)
    expect(Number.isFinite(entry!.progress)).toBe(true)

    await vi.waitFor(() => expect(mocks.aniMutation).toHaveBeenCalledTimes(1))
    expect(mocks.aniMutation.mock.calls[0]![1]).toMatchObject({ mediaId: 55, progress: 1, status: 'COMPLETED' })

    const tracking = get(localLibrary).entries['anilist:anime:101']?.tracking
    expect(tracking?.progress).toBe(1)
    expect(tracking?.status).toBe('COMPLETED')
  })
})
