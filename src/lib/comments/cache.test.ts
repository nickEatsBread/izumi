import { describe, expect, it, vi, beforeEach } from 'vitest'

// The discussion aggregation is the SDK's job; this file only proves izumi never asks for the same
// episode twice. `getDiscussion` counts calls, so a memoized fetch shows up as a flat call count.
const getDiscussion = vi.fn(async () => [
  { platform: 'reddit', id: 't1', title: 'Episode 1 discussion', comments: [] },
])
vi.mock('@nicholasyoannou/hayami-sdk', () => ({
  createDiscussionClient: () => ({ getDiscussion }),
}))
vi.mock('$lib/net/http', () => ({ invokeNativeHttp: vi.fn() }))

import { fetchDiscussion, discussionKey, clearDiscussionCache } from './index'
import type { Media } from '$lib/anilist/types'

const media = (id: number, idMal: number | null = 100): Media =>
  ({ id, idMal, title: { romaji: 'Show', english: null, userPreferred: 'Show' } }) as unknown as Media

beforeEach(() => {
  clearDiscussionCache()
  getDiscussion.mockClear()
})

describe('discussionKey', () => {
  it('ignores the identity of the carrier object', () => {
    expect(discussionKey(media(1), 3)).toBe(discussionKey(media(1), 3))
  })

  it('separates episodes, series and the MAL id', () => {
    expect(discussionKey(media(1), 3)).not.toBe(discussionKey(media(1), 4))
    expect(discussionKey(media(1), 3)).not.toBe(discussionKey(media(2), 3))
    expect(discussionKey(media(1, 100), 3)).not.toBe(discussionKey(media(1, 200), 3))
  })

  it('treats a null episode as its own key rather than colliding with episode 0', () => {
    expect(discussionKey(media(1), null)).not.toBe(discussionKey(media(1), 0))
  })
})

describe('fetchDiscussion', () => {
  it('fetches an episode once even when the media object is replaced each time', async () => {
    // Exactly the "changed source nine times" case: same episode, a brand-new Media wrapper per try.
    for (let attempt = 0; attempt < 9; attempt++) await fetchDiscussion(media(1), 3)
    expect(getDiscussion).toHaveBeenCalledTimes(1)
  })

  it('shares one in-flight request between concurrent callers', async () => {
    await Promise.all([fetchDiscussion(media(1), 3), fetchDiscussion(media(1), 3)])
    expect(getDiscussion).toHaveBeenCalledTimes(1)
  })

  it('still fetches a different episode', async () => {
    await fetchDiscussion(media(1), 3)
    await fetchDiscussion(media(1), 4)
    expect(getDiscussion).toHaveBeenCalledTimes(2)
  })

  it('does not memoize an empty result, so a transient failure can recover', async () => {
    getDiscussion.mockResolvedValueOnce([])
    expect(await fetchDiscussion(media(1), 3)).toEqual([])
    expect(await fetchDiscussion(media(1), 3)).toHaveLength(1)
    expect(getDiscussion).toHaveBeenCalledTimes(2)
  })

  it('does not memoize a rejected aggregation', async () => {
    getDiscussion.mockRejectedValueOnce(new Error('network'))
    expect(await fetchDiscussion(media(1), 3)).toEqual([])
    expect(await fetchDiscussion(media(1), 3)).toHaveLength(1)
    expect(getDiscussion).toHaveBeenCalledTimes(2)
  })
})
