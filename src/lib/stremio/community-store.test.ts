import { describe, expect, it } from 'vitest'
import { communityStoreUrl } from './community-store'

describe('community source store query', () => {
  it('defaults to a bounded, safe, top-rated directory page', () => {
    const url = new URL(communityStoreUrl())
    expect(url.origin).toBe('https://stremio-addons.net')
    expect(url.searchParams.get('nsfw')).toBe('exclude')
    expect(url.searchParams.get('sort_by')).toBe('stars')
    expect(url.searchParams.get('limit')).toBe('30')
  })

  it('encodes search and category without interpolating them into the path', () => {
    const url = new URL(communityStoreUrl({ search: 'anime & subs', category: 'anime', sort: 'new' }))
    expect(url.searchParams.get('search')).toBe('anime & subs')
    expect(url.searchParams.get('category')).toBe('anime')
    expect(url.searchParams.get('sort_by')).toBe('createdAt')
  })
})
