import { describe, it, expect } from 'vitest'
import { pickSearchResult, pickEpisode, videoSourceToStream } from './onlinestream'

describe('pickSearchResult', () => {
  const results = [
    { id: 'a', title: 'Some Other Show' },
    { id: 'b', title: 'Sousou no Frieren' },
    { id: 'c', title: 'Frieren: Beyond Journey' },
  ]
  it('picks the best token-overlap match', () => {
    const best = pickSearchResult(results, ['Frieren: Beyond Journey’s End', 'Sousou no Frieren'])
    expect(best?.id === 'b' || best?.id === 'c').toBe(true)
  })
  it('returns undefined when nothing overlaps', () => {
    expect(pickSearchResult(results, ['One Piece'])).toBeUndefined()
  })
  it('returns undefined for empty results', () => {
    expect(pickSearchResult([], ['Frieren'])).toBeUndefined()
  })
})

describe('pickEpisode', () => {
  const eps = [{ id: '1', number: 1 }, { id: '2', number: 2 }, { id: '3', number: 3 }]
  it('finds by episode number', () => {
    expect(pickEpisode(eps, 2)?.id).toBe('2')
  })
  it('undefined when absent', () => {
    expect(pickEpisode(eps, 99)).toBeUndefined()
  })
})

describe('videoSourceToStream', () => {
  it('maps a VideoSource to a direct streaming Stream', () => {
    const s = videoSourceToStream(
      { url: 'https://cdn/x.m3u8', type: 'm3u8', quality: '1080p', subtitles: [{ url: 'https://s/en.vtt', lang: 'en' }] },
      'server-1', { Referer: 'https://site' }, 'ProviderX', 'The Journey', 'sub',
    )
    expect(s.url).toBe('https://cdn/x.m3u8')
    expect(s.__stream).toBe(true)
    expect(s.__headers).toEqual({ Referer: 'https://site' })
    expect(s.__subtitles).toEqual([{ url: 'https://s/en.vtt', lang: 'en', isDefault: false }])
    expect(s.__audio).toBe('sub')
    expect(s.__addonName).toBe('ProviderX')
    expect(s.name).toContain('ProviderX')
    expect(s.name).toContain('1080p')
    expect(s.behaviorHints?.filename).toContain('The Journey')
  })

  it('normalizes the SDK subtitle shape (language + isDefault) and dub audio', () => {
    const s = videoSourceToStream(
      { url: 'https://cdn/y.m3u8', type: 'm3u8', quality: 'auto', subtitles: [{ url: 'https://s/e.vtt', language: 'en', isDefault: true }] },
      'srv', {}, 'ProviderY', undefined, 'dub',
    )
    expect(s.__subtitles).toEqual([{ url: 'https://s/e.vtt', lang: 'en', isDefault: true }])
    expect(s.__audio).toBe('dub')
    // no episode title → a sensible direct-stream filename
    expect(s.behaviorHints?.filename).toContain('Direct')
  })
})
