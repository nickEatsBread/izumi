import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ post: vi.fn() }))

vi.mock('$lib/net/http', () => ({ invokeNativeHttp: mocks.post }))

import { gql } from '@urql/core'
import { anilistToken } from './auth'
import { anilist, parseRateLimitHeaders } from './client'

const QUERY = gql`query ($id: Int!) { Media(id: $id) { id mediaListEntry { id progress } } }`

type Entry = { Media: { mediaListEntry: { progress: number } } }

// Minimal AniList-shaped reply. __typename is required: graphcache normalizes by it.
const reply = (progress: number) => ({
  status: 200,
  headers: {},
  body: JSON.stringify({
    data: {
      Media: {
        __typename: 'Media', id: 1,
        mediaListEntry: { __typename: 'MediaList', id: 9, progress },
      },
    },
  }),
})

describe('anilist client', () => {
  beforeEach(() => { mocks.post.mockReset() })

  it('never serves the previous account\'s list entry after a token change', async () => {
    anilistToken.set('token-a')
    mocks.post.mockResolvedValue(reply(5))
    const a = await anilist.query<Entry>(QUERY, { id: 1 }).toPromise()
    expect(a.data?.Media.mediaListEntry.progress).toBe(5)
    expect(mocks.post).toHaveBeenCalledTimes(1)

    // Same account: cache-first answers from the normalized cache, no second request.
    await anilist.query<Entry>(QUERY, { id: 1 }).toPromise()
    expect(mocks.post).toHaveBeenCalledTimes(1)

    // Switching accounts must drop that cache, so the viewer-scoped entry is re-fetched.
    anilistToken.set('token-b')
    mocks.post.mockResolvedValue(reply(0))
    const b = await anilist.query<Entry>(QUERY, { id: 1 }).toPromise()
    expect(mocks.post).toHaveBeenCalledTimes(2)
    expect(b.data?.Media.mediaListEntry.progress).toBe(0)
  })

  it('keeps the cache when the token store re-emits an unchanged value', async () => {
    anilistToken.set('token-same')
    mocks.post.mockResolvedValue(reply(7))
    await anilist.query<Entry>(QUERY, { id: 1 }).toPromise()
    anilistToken.set('token-same')
    await anilist.query<Entry>(QUERY, { id: 1 }).toPromise()
    expect(mocks.post).toHaveBeenCalledTimes(1)
  })
})

describe('AniList rate-limit headers', () => {
  it('reads the shared-IP remainder and reset without inventing absent values', () => {
    expect(parseRateLimitHeaders(new Headers())).toEqual({
      limit: undefined,
      remaining: undefined,
      resetAtMs: undefined,
    })
    expect(parseRateLimitHeaders(new Headers({
      'x-ratelimit-limit': '30',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': '2000000000',
    }))).toEqual({ limit: 30, remaining: 0, resetAtMs: 2_000_000_000_000 })
  })
})
