import { describe, expect, it } from 'vitest'
import { defaultPlaybackLanguages, iso639_2 } from './playback-languages'

const anime = { anime: true, films: false }
const films = { anime: false, films: true }
const both = { anime: true, films: true }

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

describe('playback language defaults', () => {
  it('subs an anime library regardless of where the user is', () => {
    expect(defaultPlaybackLanguages(anime, 'de-DE')).toEqual({ audio: 'jpn', subtitle: 'eng' })
    expect(defaultPlaybackLanguages(both, 'de-DE')).toEqual({ audio: 'jpn', subtitle: 'eng' })
  })

  it('follows the system language when no anime library was chosen', () => {
    expect(defaultPlaybackLanguages(films, 'de-DE')).toEqual({ audio: 'ger', subtitle: 'ger' })
    expect(defaultPlaybackLanguages(films, 'ja')).toEqual({ audio: 'jpn', subtitle: 'jpn' })
  })

  it('falls back to English when the system language cannot be resolved', () => {
    expect(defaultPlaybackLanguages(films, 'zz')).toEqual({ audio: 'eng', subtitle: 'eng' })
    expect(defaultPlaybackLanguages(films, undefined)).toEqual({ audio: 'eng', subtitle: 'eng' })
  })
})
