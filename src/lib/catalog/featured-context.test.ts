import { describe, expect, it } from 'vitest'
import type { Media } from '$lib/anilist/types'
import { interleaveFeatured, rankFeaturedMedia } from './featured-context'

const media = (id: number): Media => ({ id, title: { userPreferred: `Title ${id}` } })

describe('featured catalogue context', () => {
  it('keeps the provider list position and label on every title', () => {
    expect(rankFeaturedMedia([media(1), media(2)], 'Movies Today').map((item) => item.featuredRank))
      .toEqual([{ position: 1, label: 'Movies Today' }, { position: 2, label: 'Movies Today' }])
  })

  it('interleaves ranked lists while retaining their independent positions', () => {
    const movies = rankFeaturedMedia([media(1), media(2)], 'Movies Today')
    const series = rankFeaturedMedia([media(3), media(4)], 'Series Today')
    expect(interleaveFeatured([movies, series], 3).map((item) => [item.id, item.featuredRank]))
      .toEqual([
        [1, { position: 1, label: 'Movies Today' }],
        [3, { position: 1, label: 'Series Today' }],
        [2, { position: 2, label: 'Movies Today' }],
      ])
  })
})
