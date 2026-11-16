import { describe, expect, it, vi } from 'vitest'
import { prefetchDetail, takePrefetchedDetail, titleRefFromPath } from './detail-prefetch'
import type { MediaRef } from './identity'

const ref = { provider: 'stremio', type: 'series', id: '["source-x","series","x:1"]' } as MediaRef
const loader = (detail: ReturnType<typeof vi.fn>) => (async () => ({ detail })) as unknown as Parameters<typeof prefetchDetail>[1]

describe('title details fetched while the card has focus', () => {
  it('reads the title from a catalog title page address, once decoded as the route does', () => {
    expect(titleRefFromPath('/app/media/stremio/series/%5B%22source-x%22%2C%22series%22%2C%22x%3A1%22%5D')).toEqual(ref)
    expect(titleRefFromPath('/app/media/anilist/anime/21')).toBeNull()
    expect(titleRefFromPath('/app/home')).toBeNull()
  })

  it('hands a prefetch to one open within 30 s, then fetches afresh', async () => {
    const detail = vi.fn(async () => ({ id: 1 }))
    prefetchDetail(ref, loader(detail), 1000)
    prefetchDetail(ref, loader(detail), 1100)
    expect(await takePrefetchedDetail(ref, 2000)).toEqual({ id: 1 })
    expect(detail).toHaveBeenCalledTimes(1)
    expect(takePrefetchedDetail(ref, 2100)).toBeUndefined()

    prefetchDetail(ref, loader(detail), 5000)
    expect(takePrefetchedDetail(ref, 40_000)).toBeUndefined()
  })
})
