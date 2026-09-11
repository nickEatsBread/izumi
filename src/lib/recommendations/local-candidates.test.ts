import { get } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The idle scheduler is mocked, not faked with timers: the pool priming must stay OFF the
// critical path, so each test controls exactly when (and whether) the queued callback runs.
const idleQueue: Array<() => void> = []
vi.mock('$lib/util/idle', () => ({
  idle: (cb: () => void) => { idleQueue.push(cb); return { cancel: () => {} } },
}))
const mocks = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('./candidates', () => ({ loadDiscoveryCandidates: mocks.load }))

const media = (id: number) => ({ id, title: { userPreferred: String(id) } })

// Module-level cache: reset the registry between tests so every case starts cold.
let localCandidates: typeof import('./local-candidates')
const tick = async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)) }

beforeEach(async () => {
  vi.resetModules()
  idleQueue.length = 0
  mocks.load.mockReset()
  localCandidates = await import('./local-candidates')
  localCandidates.resetLocalCandidatePool()
})

describe('local candidate pool', () => {
  it('gathers from the installed catalogs on the idle callback, never synchronously', async () => {
    mocks.load.mockResolvedValue({ media: [media(1), media(2)], failedProviders: [], hasNextPage: false })
    localCandidates.primeLocalCandidates(['stremio'])
    expect(idleQueue).toHaveLength(1)
    expect(mocks.load).not.toHaveBeenCalled()
    expect(get(localCandidates.localCandidatePool)).toEqual([])

    idleQueue[0]()
    expect(get(localCandidates.localCandidatesLoading)).toBe(true)
    await tick()
    expect(mocks.load).toHaveBeenCalledWith(['stremio'])
    expect(get(localCandidates.localCandidatePool).map((item) => item.id)).toEqual([1, 2])
    expect(get(localCandidates.localCandidatesLoading)).toBe(false)
  })

  it('does not gather again while the cached pool is fresh', async () => {
    mocks.load.mockResolvedValue({ media: [media(1)], failedProviders: [], hasNextPage: false })
    localCandidates.primeLocalCandidates(['stremio'])
    idleQueue[0]()
    await tick()

    localCandidates.primeLocalCandidates(['stremio'])
    expect(idleQueue).toHaveLength(1)
    expect(mocks.load).toHaveBeenCalledOnce()
  })

  it('stays empty and clears the loading flag when every catalog fails, then retries while cold', async () => {
    mocks.load.mockRejectedValueOnce(new Error('catalogs unreachable'))
    localCandidates.primeLocalCandidates(['stremio'])
    idleQueue[0]()
    await tick()
    expect(get(localCandidates.localCandidatePool)).toEqual([])
    expect(get(localCandidates.localCandidatesLoading)).toBe(false)

    // A failed gather leaves the cache cold, so the next prime schedules a real retry.
    mocks.load.mockResolvedValueOnce({ media: [media(1)], failedProviders: [], hasNextPage: false })
    localCandidates.primeLocalCandidates(['kitsu'])
    expect(idleQueue).toHaveLength(2)
    idleQueue[1]()
    await tick()
    expect(get(localCandidates.localCandidatePool).map((item) => item.id)).toEqual([1])
  })

  it('caps the pool so a large add-on cannot balloon the row input', async () => {
    mocks.load.mockResolvedValue({
      media: Array.from({ length: 600 }, (_, index) => media(index + 1)),
      failedProviders: [],
      hasNextPage: false,
    })
    localCandidates.primeLocalCandidates(['stremio'])
    idleQueue[0]()
    await tick()
    expect(get(localCandidates.localCandidatePool)).toHaveLength(400)
  })

  it('coalesces overlapping primes into a single in-flight refresh', async () => {
    let release!: (value: unknown) => void
    mocks.load.mockReturnValue(new Promise((resolve) => { release = resolve }))
    localCandidates.primeLocalCandidates(['stremio'])
    idleQueue[0]()
    localCandidates.primeLocalCandidates(['stremio'])
    expect(idleQueue).toHaveLength(1)
    release({ media: [media(1)], failedProviders: [], hasNextPage: false })
    await tick()
    expect(mocks.load).toHaveBeenCalledOnce()
  })
})
