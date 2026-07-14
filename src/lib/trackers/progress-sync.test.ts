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

import { localHistory, sessionProgress } from '$lib/player/history'
import { saveLocalHistory } from '$lib/settings/ui'
import { anilistToken, malToken } from './config'
import { markWatched } from './index'
import type { Media } from '$lib/anilist/types'

const media = (episodes = 12): Media => ({
  id: 101,
  idMal: 202,
  title: { romaji: 'Test Show' },
  episodes,
})

describe('watched episode tracker sync', () => {
  beforeEach(() => {
    mocks.aniMutation.mockReset()
    mocks.malFetch.mockReset()
    mocks.aniMutation.mockReturnValue({ toPromise: async () => ({ data: {} }) })
    mocks.malFetch.mockResolvedValue(new Response('', { status: 200 }))
    anilistToken.set('ani-token')
    malToken.set('mal-token')
    saveLocalHistory.set(true)
    localHistory.set({})
    sessionProgress.set({})
  })

  afterEach(() => {
    anilistToken.set(null)
    malToken.set(null)
    localHistory.set({})
    sessionProgress.set({})
  })

  it('pushes the watched episode to AniList and MyAnimeList', async () => {
    markWatched(media(), 4)

    await vi.waitFor(() => {
      expect(mocks.aniMutation).toHaveBeenCalledTimes(1)
      expect(mocks.malFetch).toHaveBeenCalledTimes(1)
    })

    expect(mocks.aniMutation.mock.calls[0][1]).toMatchObject({
      mediaId: 101,
      progress: 4,
      status: 'CURRENT',
    })
    const malInit = mocks.malFetch.mock.calls[0][1] as RequestInit
    const malBody = new URLSearchParams(malInit.body as string)
    expect(malBody.get('num_watched_episodes')).toBe('4')
    expect(malBody.get('status')).toBe('watching')
    let session: Record<number, number> = {}
    sessionProgress.subscribe((value) => (session = value))()
    expect(session[101]).toBe(4)
  })

  it('marks both tracker entries completed on the final episode', async () => {
    markWatched(media(), 12)

    await vi.waitFor(() => {
      expect(mocks.aniMutation).toHaveBeenCalledTimes(1)
      expect(mocks.malFetch).toHaveBeenCalledTimes(1)
    })

    expect(mocks.aniMutation.mock.calls[0][1]).toMatchObject({
      progress: 12,
      status: 'COMPLETED',
    })
    const malInit = mocks.malFetch.mock.calls[0][1] as RequestInit
    const malBody = new URLSearchParams(malInit.body as string)
    expect(malBody.get('num_watched_episodes')).toBe('12')
    expect(malBody.get('status')).toBe('completed')
  })

  it('keeps the in-session row progress current when saved history is disabled', async () => {
    saveLocalHistory.set(false)
    markWatched(media(), 4)

    await vi.waitFor(() => expect(mocks.aniMutation).toHaveBeenCalledTimes(1))

    let history: Record<number, unknown> = {}
    localHistory.subscribe((value) => (history = value))()
    expect(history).toEqual({})
    let session: Record<number, number> = {}
    sessionProgress.subscribe((value) => (session = value))()
    expect(session[101]).toBe(4)
  })
})
