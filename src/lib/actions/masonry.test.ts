import { describe, expect, it } from 'vitest'
import { masonryRowSpan } from './masonry'

describe('masonryRowSpan', () => {
  it('packs cards into the smallest whole number of grid rows', () => {
    expect(masonryRowSpan(100, 1, 8)).toBe(12)
    expect(masonryRowSpan(101, 1, 8)).toBe(13)
  })

  it('keeps empty or invalid measurements to one row', () => {
    expect(masonryRowSpan(0, 1, 8)).toBe(1)
    expect(masonryRowSpan(100, 0, 8)).toBe(1)
  })
})
