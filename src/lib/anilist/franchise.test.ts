import { describe, expect, it } from 'vitest'
import { sortFranchiseMedia } from './franchise'
import type { Media } from './types'

const media = (id: number, year?: number, month?: number, format = 'TV'): Media => ({
  id,
  title: { userPreferred: String(id) },
  format,
  startDate: year ? { year, month } : undefined,
})

describe('franchise ordering', () => {
  it('orders productions chronologically and leaves unknown dates last', () => {
    expect(sortFranchiseMedia([
      media(3),
      media(2, 2020, 10),
      media(1, 2019, 4),
    ]).map((item) => item.id)).toEqual([1, 2, 3])
  })

  it('puts the television entry before a same-day movie', () => {
    expect(sortFranchiseMedia([
      media(2, 2020, 1, 'MOVIE'),
      media(1, 2020, 1, 'TV'),
    ]).map((item) => item.id)).toEqual([1, 2])
  })
})
