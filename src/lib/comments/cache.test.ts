import { describe, expect, it, vi, beforeEach } from 'vitest'

// The discussion aggregation is the SDK's job; this file only proves izumi never asks for the same
// episode twice. `getDiscussion` counts calls, so a memoized fetch shows up as a flat call count.
const mocks = vi.hoisted(() => ({
  nativeHttp: vi.fn(),
  getDiscussion: vi.fn(async () => [
    { platform: 'reddit', id: 't1', title: 'Episode 1 discussion', comments: [] },
  ]),
}))
vi.mock('@nicholasyoannou/hayami-sdk', () => ({
  createDiscussionClient: () => ({ getDiscussion: mocks.getDiscussion }),
}))
vi.mock('$lib/net/http', () => ({ invokeNativeHttp: mocks.nativeHttp }))

import { fetchDiscussion, discussionKey, clearDiscussionCache, commentsBackendUrl } from './index'
import type { Media } from '$lib/anilist/types'

const media = (id: number, idMal: number | null = 100): Media =>
  ({ id, idMal, title: { romaji: 'Show', english: null, userPreferred: 'Show' } }) as unknown as Media

beforeEach(() => {
  clearDiscussionCache()
  commentsBackendUrl.set('')
  mocks.getDiscussion.mockReset()
  mocks.getDiscussion.mockResolvedValue([
    { platform: 'reddit', id: 't1', title: 'Episode 1 discussion', comments: [] },
  ])
  mocks.nativeHttp.mockReset()
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
    expect(mocks.getDiscussion).toHaveBeenCalledTimes(1)
  })

  it('shares one in-flight request between concurrent callers', async () => {
    await Promise.all([fetchDiscussion(media(1), 3), fetchDiscussion(media(1), 3)])
    expect(mocks.getDiscussion).toHaveBeenCalledTimes(1)
  })

  it('still fetches a different episode', async () => {
    await fetchDiscussion(media(1), 3)
    await fetchDiscussion(media(1), 4)
    expect(mocks.getDiscussion).toHaveBeenCalledTimes(2)
  })

  it('does not memoize an empty result, so a transient failure can recover', async () => {
    mocks.getDiscussion.mockResolvedValueOnce([])
    expect(await fetchDiscussion(media(1), 3)).toEqual([])
    expect(await fetchDiscussion(media(1), 3)).toHaveLength(1)
    expect(mocks.getDiscussion).toHaveBeenCalledTimes(2)
  })

  it('does not memoize a rejected aggregation', async () => {
    mocks.getDiscussion.mockRejectedValueOnce(new Error('network'))
    expect(await fetchDiscussion(media(1), 3)).toEqual([])
    expect(await fetchDiscussion(media(1), 3)).toHaveLength(1)
    expect(mocks.getDiscussion).toHaveBeenCalledTimes(2)
  })

  it('publishes an embeddable forum thread before slow aggregation completes', async () => {
    commentsBackendUrl.set('https://mapper.example')
    let finishAggregation!: (threads: any[]) => void
    mocks.getDiscussion.mockImplementationOnce(() => new Promise((resolve) => { finishAggregation = resolve }))
    mocks.nativeHttp.mockResolvedValue({
      status: 200,
      headers: {},
      body: JSON.stringify({
        threads: [{
          id: 12, slug: 'show-episode-3', title: 'Episode 3', episode_number: 3,
          episode_number_end: null, comment_count: 42, created_at: 1,
          identifier: 'show-episode-3', url: 'https://example.com/thread',
          forum_shortname: 'discussanime', is_embed: 0,
        }],
        has_more: false,
      }),
    })
    const early = vi.fn()
    const pending = fetchDiscussion(media(1), 3, early)

    await vi.waitFor(() => expect(early).toHaveBeenCalledOnce())
    expect(early.mock.calls[0][0][0]).toMatchObject({ source: 'Disqus', replyCount: 42 })
    expect(early.mock.calls[0][0][0].embedUrl).toContain('disqus.com/embed/comments')

    finishAggregation([{ platform: 'reddit', id: 'r3', title: 'Episode 3', comments: [] }])
    await expect(pending).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'Disqus' }),
      expect.objectContaining({ source: 'Reddit' }),
    ]))
    const cachedEarly = vi.fn()
    await fetchDiscussion(media(1), 3, cachedEarly)
    expect(cachedEarly).not.toHaveBeenCalled()
  })
})
