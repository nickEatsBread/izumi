import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), phttp: vi.fn() }))
vi.mock('idb-keyval', () => ({ get: mocks.get, set: mocks.set }))
vi.mock('$lib/net/http', () => ({ phttp: mocks.phttp }))
vi.mock('$lib/stremio/idmap', () => ({ getIndex: vi.fn(), lookupAnilistByMal: vi.fn() }))

import { fetchMalRating } from './jikan'

const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body })

describe('fetchMalRating', () => {
  beforeEach(() => {
    mocks.get.mockReset(); mocks.set.mockReset(); mocks.phttp.mockReset()
    mocks.set.mockResolvedValue(undefined)
  })
  it('reads the rating once and caches it', async () => {
    mocks.get.mockResolvedValueOnce(undefined)
    mocks.phttp.mockResolvedValueOnce(reply({ data: { rating: 'PG-13 - Teens 13 or older' } }))
    await expect(fetchMalRating(52991)).resolves.toBe('PG-13 - Teens 13 or older')
    expect(mocks.phttp.mock.calls[0][0]).toBe('https://api.jikan.moe/v4/anime/52991')
    expect(mocks.set).toHaveBeenCalledWith('mal-rating-52991', { at: expect.any(Number), rating: 'PG-13 - Teens 13 or older' })
    mocks.get.mockResolvedValueOnce({ at: Date.now(), rating: 'PG-13 - Teens 13 or older' })
    await expect(fetchMalRating(52991)).resolves.toBe('PG-13 - Teens 13 or older')
    expect(mocks.phttp).toHaveBeenCalledTimes(1)
  })
  it('remembers a title without a rating as null', async () => {
    mocks.get.mockResolvedValueOnce(undefined)
    mocks.phttp.mockResolvedValueOnce(reply({ data: { rating: null } }))
    await expect(fetchMalRating(1)).resolves.toBeNull()
    expect(mocks.set).toHaveBeenCalledWith('mal-rating-1', { at: expect.any(Number), rating: null })
  })
  it('refetches a month-old entry', async () => {
    mocks.get.mockResolvedValueOnce({ at: Date.now() - 31 * 864e5, rating: 'G - All Ages' })
    mocks.phttp.mockResolvedValueOnce(reply({ data: { rating: 'PG - Children' } }))
    await expect(fetchMalRating(2)).resolves.toBe('PG - Children')
  })
})
