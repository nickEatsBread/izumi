import { describe, it, expect } from 'vitest'
import { orderEpisodes } from '$lib/anime/episode-order'

describe('orderEpisodes', () => {
  it('leaves ascending order untouched', () => {
    expect(orderEpisodes([1, 2, 3], 'asc')).toEqual([1, 2, 3])
  })
  it('reverses for descending (newest first)', () => {
    expect(orderEpisodes([1, 2, 3], 'desc')).toEqual([3, 2, 1])
  })
  it('does not mutate the input', () => {
    const src = [1, 2, 3]
    orderEpisodes(src, 'desc')
    expect(src).toEqual([1, 2, 3])
  })
})
