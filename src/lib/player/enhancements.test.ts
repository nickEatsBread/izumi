import { describe, expect, it } from 'vitest'
import { audioFilter, subtitleFilterOptions, vsrFilter } from './enhancements'

describe('playback enhancement options', () => {
  it('keeps processing disabled by default', () => {
    expect(audioFilter('off')).toBe('')
    expect(vsrFilter('off')).toBe('')
  })
  it('maps dialogue/night and both Windows VSR modes', () => {
    expect(audioFilter('dialogue')).toContain('dynaudnorm')
    expect(audioFilter('night')).toContain('loudnorm')
    expect(vsrFilter('nvidia')).toBe('d3d11vpp=scaling-mode=nvidia')
    expect(vsrFilter('intel')).toBe('d3d11vpp=scaling-mode=intel')
  })
  it('only enables the harder SDH mode when stripping is enabled and sanitizes newlines', () => {
    expect(Object.fromEntries(subtitleFilterOptions(false, true, 'a\nb'))).toEqual({
      'sub-filter-sdh': 'no',
      'sub-filter-sdh-harder': 'no',
      'sub-filter-regex': 'a b',
    })
  })
})
