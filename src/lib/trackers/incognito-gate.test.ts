import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  aniMutation: vi.fn(),
  malFetch: vi.fn(),
}))

vi.mock('$lib/anilist/client', () => ({
  anilist: { mutation: mocks.aniMutation },
}))

vi.mock('./mal-auth', () => ({
  malFetch: mocks.malFetch,
}))

import { get } from 'svelte/store'
import { enterIncognito, exitIncognito, incognito } from '$lib/stores/incognito'
import { durableHistory, incognitoHistory, sessionProgress } from '$lib/player/history'
import { saveLocalHistory } from '$lib/settings/ui'
import { anilistToken, malToken } from './config'
import { trackerQueue } from './queue'
import { markWatched, setStatus, setScore, removeFromList, toggleFavourite } from './index'
import type { Media } from '$lib/anilist/types'

const media = (episodes = 12): Media => ({
  id: 101,
  idMal: 202,
  title: { romaji: 'Secret Show' },
  episodes,
})

describe('incognito tracker gate', () => {
  beforeEach(() => {
    mocks.aniMutation.mockReset()
    mocks.malFetch.mockReset()
    mocks.aniMutation.mockReturnValue({ toPromise: async () => ({ data: {} }) })
    mocks.malFetch.mockResolvedValue(new Response('', { status: 200 }))
    anilistToken.set('ani-token')
    malToken.set('mal-token')
    saveLocalHistory.set(true)
    incognito.set(false)
    durableHistory.set({})
    incognitoHistory.set({})
    sessionProgress.set({})
    trackerQueue.set([])
  })

  afterEach(() => {
    incognito.set(false)
    anilistToken.set(null)
    malToken.set(null)
    durableHistory.set({})
    incognitoHistory.set({})
    sessionProgress.set({})
    trackerQueue.set([])
  })

  it('suppresses every tracker write while incognito, with nothing queued for later', async () => {
    enterIncognito()
    markWatched(media(), 4)
    expect(await setStatus(media(), 'PLANNING')).toEqual([])
    expect(await setScore(media(), 80)).toEqual([])
    expect(await removeFromList(media())).toEqual([])

    expect(mocks.aniMutation).not.toHaveBeenCalled()
    expect(mocks.malFetch).not.toHaveBeenCalled()
    expect(get(trackerQueue)).toEqual([]) // a queued op would sync after the session — must be empty

    // The watch still landed in the session overlay so Continue Watching works.
    expect(get(incognitoHistory)[101]?.progress).toBe(4)
    expect(get(durableHistory)).toEqual({})
  })

  it('rejects favourite toggles while incognito (the one mutation that bypasses push)', async () => {
    enterIncognito()
    await expect(toggleFavourite(media())).rejects.toThrow(/incognito/i)
    expect(mocks.aniMutation).not.toHaveBeenCalled()
  })

  it('resumes normal tracking after incognito ends', async () => {
    enterIncognito()
    markWatched(media(), 4)
    exitIncognito()
    markWatched(media(), 5)

    await vi.waitFor(() => {
      expect(mocks.aniMutation).toHaveBeenCalledTimes(1)
      expect(mocks.malFetch).toHaveBeenCalledTimes(1)
    })
    expect(mocks.aniMutation.mock.calls[0][1]).toMatchObject({ mediaId: 101, progress: 5 })
    // The incognito episode-4 watch is gone; only the post-incognito watch persisted.
    expect(get(durableHistory)[101]?.progress).toBe(5)
  })
})
