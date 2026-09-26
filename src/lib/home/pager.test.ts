import { describe, expect, it } from 'vitest'
import { pageWindow } from './pager'

describe('page window', () => {
  it('shows the first page, neighbours and the last known page', () => {
    expect(pageWindow(1, false)).toEqual([1])
    expect(pageWindow(1, true)).toEqual([1, 2])
    expect(pageWindow(5, true)).toEqual([1, 'gap', 4, 5, 6])
    expect(pageWindow(5, false, 5)).toEqual([1, 'gap', 4, 5])
    expect(pageWindow(3, true, 10)).toEqual([1, 2, 3, 4, 'gap', 10])
    expect(pageWindow(2, true, 3)).toEqual([1, 2, 3])
  })
})
