import { describe, it, expect } from 'vitest'
import { nextTrack, prevTrack, lofiUrl, LOFI_COUNT } from './lofi'

describe('lofi track helpers', () => {
  it('nextTrack advances and wraps at the end', () => {
    expect(nextTrack(0)).toBe(1)
    expect(nextTrack(LOFI_COUNT - 1)).toBe(0)
  })
  it('prevTrack retreats and wraps at the start', () => {
    expect(prevTrack(1)).toBe(0)
    expect(prevTrack(0)).toBe(LOFI_COUNT - 1)
  })
  it('lofiUrl maps a 0-based index to lofN.ogg', () => {
    expect(lofiUrl(0)).toBe('https://lofmu-prod-pubdist.quack.si/lof1.ogg')
    expect(lofiUrl(3)).toBe('https://lofmu-prod-pubdist.quack.si/lof4.ogg')
  })
})
