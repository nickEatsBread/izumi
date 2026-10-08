import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ phttp: vi.fn() }))
vi.mock('$lib/net/http', () => ({ phttp: mocks.phttp }))

import { kitsuIdFromLinks, kitsuIdFromMal } from './kitsu'

const answer = (id?: string) => ({ ok: true, json: async () => ({ included: id ? [{ id }] : [] }) })
const site = (url: string) => decodeURIComponent(new URL(url).searchParams.get('filter[externalSite]') ?? '')

describe('Kitsu mapping lookups', () => {
  // A block body: Vitest runs a function returned from beforeEach as the test's cleanup hook.
  beforeEach(() => { mocks.phttp.mockReset() })

  it('finds a new show Kitsu links to AniList before it links it to MAL', async () => {
    mocks.phttp.mockImplementation(async (url: string) => answer(site(url) === 'anilist/anime' ? '51005' : undefined))
    await expect(kitsuIdFromLinks({ anilist: 186541, mal: 60948 })).resolves.toBe(51005)
    expect(mocks.phttp).toHaveBeenCalledTimes(2)
    expect(mocks.phttp.mock.calls.map(([url]) => site(url)).sort()).toEqual(['anilist/anime', 'myanimelist/anime'])
  })

  it('still answers from MAL when only that link exists', async () => {
    mocks.phttp.mockImplementation(async (url: string) => answer(site(url) === 'myanimelist/anime' ? '46917' : undefined))
    await expect(kitsuIdFromLinks({ anilist: 159042, mal: 53913 })).resolves.toBe(46917)
  })

  it('does not wait for the MAL link once the AniList link answered', async () => {
    let finishMal!: (value: unknown) => void
    mocks.phttp.mockImplementation((url: string) => site(url) === 'anilist/anime'
      ? Promise.resolve(answer('51005'))
      : new Promise((resolve) => { finishMal = resolve }))
    await expect(kitsuIdFromLinks({ anilist: 186541, mal: 60948 })).resolves.toBe(51005)
    finishMal(answer(undefined))
  })

  it('prefers the AniList link when the two links disagree, whichever answers first', async () => {
    let finishAnilist!: (value: unknown) => void
    mocks.phttp.mockImplementation((url: string) => site(url) === 'anilist/anime'
      ? new Promise((resolve) => { finishAnilist = resolve })
      : Promise.resolve(answer('2')))
    const id = kitsuIdFromLinks({ anilist: 1, mal: 1 })
    await vi.waitFor(() => expect(finishAnilist).toBeTypeOf('function'))
    finishAnilist(answer('1'))
    await expect(id).resolves.toBe(1)
  })

  it('is undefined when neither link exists or a lookup fails', async () => {
    mocks.phttp.mockImplementation(async (url: string) => {
      if (site(url) === 'anilist/anime') throw new Error('offline')
      return { ok: false, json: async () => ({}) }
    })
    await expect(kitsuIdFromLinks({ anilist: 1, mal: 2 })).resolves.toBeUndefined()
  })

  it('skips ids it does not have', async () => {
    await expect(kitsuIdFromLinks({})).resolves.toBeUndefined()
    await expect(kitsuIdFromMal(undefined)).resolves.toBeUndefined()
    expect(mocks.phttp).not.toHaveBeenCalled()
  })

  it('percent-encodes the filter so the native HTTP client accepts it', async () => {
    mocks.phttp.mockResolvedValue(answer('7'))
    await kitsuIdFromMal(1)
    expect(mocks.phttp.mock.calls[0][0]).toBe(
      'https://kitsu.io/api/edge/mappings?filter%5BexternalSite%5D=myanimelist%2Fanime&filter%5BexternalId%5D=1&include=item',
    )
  })
})
