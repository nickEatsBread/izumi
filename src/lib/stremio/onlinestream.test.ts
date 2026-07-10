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
      'VidCloud', { Referer: 'https://site' }, 'HiAnime', 'The Journey',
    )
    expect(s.url).toBe('https://cdn/x.m3u8')
    expect(s.__stream).toBe(true)
    expect(s.__headers).toEqual({ Referer: 'https://site' })
    expect(s.__subtitles).toEqual([{ url: 'https://s/en.vtt', lang: 'en' }])
    expect(s.name).toContain('HiAnime')
    expect(s.name).toContain('1080p')
    expect(s.behaviorHints?.filename).toContain('The Journey')
  })
})
