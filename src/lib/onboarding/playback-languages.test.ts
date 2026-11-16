import { describe, expect, it } from 'vitest'
import { iso639_2 } from './playback-languages'

describe('system language mapping', () => {
  it('maps a two-letter locale to its ISO 639-2 code', () => {
    expect(iso639_2('ja')).toBe('jpn')
    expect(iso639_2('de')).toBe('ger')
  })

  it('ignores the region and the casing a browser locale carries', () => {
    expect(iso639_2('en-GB')).toBe('eng')
    expect(iso639_2('PT_br')).toBe('por')
  })

  it('gives up on anything that is not a two-letter tag', () => {
    expect(iso639_2(undefined)).toBeUndefined()
    expect(iso639_2('')).toBeUndefined()
    expect(iso639_2('eng')).toBeUndefined()
    expect(iso639_2('zz')).toBeUndefined()
  })
})
