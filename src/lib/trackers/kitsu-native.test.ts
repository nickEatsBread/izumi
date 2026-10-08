import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), mapping: vi.fn() }))
vi.mock('./kitsu-auth', () => ({ kitsuFetch: mocks.fetch, refreshKitsuViewer: vi.fn() }))
vi.mock('$lib/anizip', () => ({ getKitsuId: mocks.mapping }))
vi.mock('$lib/stremio/idmap', () => ({ getIndex: mocks.mapping, lookupAnilistByKitsu: vi.fn(), lookupKitsu: vi.fn() }))
vi.mock('$lib/stremio/kitsu', () => ({ kitsuIdFromMal: mocks.mapping, kitsuIdFromLinks: mocks.mapping }))

import { getKitsuProgress } from './kitsu'
import { kitsuToken, kitsuUserId } from './config'

afterEach(() => { kitsuToken.set(null); kitsuUserId.set(''); vi.clearAllMocks() })

describe('native Kitsu detail tracking', () => {
  it('loads tracking by the native Kitsu id without an AniList mapping', async () => {
    kitsuToken.set('test'); kitsuUserId.set('viewer')
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: 'entry', attributes: { progress: 19, status: 'current', ratingTwenty: 16 } },
    ] })))
    expect(await getKitsuProgress(-123, undefined, 48293)).toEqual({ progress: 19, status: 'current', score: 80 })
    expect(new URL(mocks.fetch.mock.calls[0][0]).searchParams.get('filter[animeId]')).toBe('48293')
    expect(mocks.mapping).not.toHaveBeenCalled()
  })

  it('does not contact a tracker when disconnected', async () => {
    expect(await getKitsuProgress(-123, undefined, 48293)).toBeNull()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
