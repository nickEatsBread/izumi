import { describe, it, expect } from 'vitest'
import { progressKey, watched } from './progress'

describe('progress helpers', () => {
  it('keys by media + episode', () => expect(progressKey(101, 3)).toBe('101:3'))
  it('watched() true at/above 85% with a known duration', () => {
    expect(watched(850, 1000)).toBe(true)
    expect(watched(840, 1000)).toBe(false)
    expect(watched(10, 0)).toBe(false) // unknown duration
  })
})
