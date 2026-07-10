import { describe, it, expect } from 'vitest'
import { isUncached } from './parse'

describe('streaming source cache state', () => {
  it('a __stream source is never uncached', () => {
    expect(isUncached({ url: 'https://cdn/x.m3u8', __stream: true })).toBe(false)
  })
})
