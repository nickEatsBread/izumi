import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), phttp: vi.fn() }))
vi.mock('idb-keyval', () => ({ get: mocks.get, set: mocks.set }))
vi.mock('$lib/net/http', () => ({ phttp: mocks.phttp }))

afterEach(() => {
  vi.useRealTimers()
  vi.resetModules()
  mocks.get.mockReset()
  mocks.set.mockReset()
  mocks.phttp.mockReset()
})

describe('indexWithin', () => {
  it('returns the list once it loads inside the budget', async () => {
    mocks.get.mockImplementation(async (key: string) => key === 'anime-id-map-ts' ? Date.now() : [{ anilist_id: 1, kitsu_id: 11 }])
    const { indexWithin, lookupKitsu } = await import('./idmap')
    const index = await indexWithin(1_000)
    expect(index && lookupKitsu(index, 1)).toBe(11)
  })

  it('gives up at the budget without cancelling the load for the next caller', async () => {
    vi.useFakeTimers()
    let finish!: (value: unknown) => void
    mocks.get.mockImplementation((key: string) => key === 'anime-id-map-ts'
      ? Promise.resolve(Date.now())
      : new Promise((resolve) => { finish = resolve }))
    const { cachedIndex, indexWithin } = await import('./idmap')
    const late = indexWithin(1_500)
    await vi.advanceTimersByTimeAsync(1_500)
    await expect(late).resolves.toBeNull()
    finish([{ anilist_id: 1, kitsu_id: 11 }])
    await vi.waitFor(() => expect(cachedIndex()?.size).toBe(1))
  })
})
