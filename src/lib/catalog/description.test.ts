import { describe, expect, it } from 'vitest'
import { parseCatalogDescription } from './description'

describe('catalog description parsing', () => {
  it('splits an Aniyomi rich description into synopsis, score, facts, titles, and safe links', () => {
    const parsed = parseCatalogDescription(
      '★★★★☆ 8.6 Third season of Mushoku Tensei. **Type:** TV | **Season:** Summer 2026 | '
      + '**Duration:** 23m | **Rating:** R - 17+ (violence & profanity) **Date Aired:** Jul 6, 2026 '
      + '**Date Ended:** Sep 28, 2026 **Alternative Titles:** - Mushoku Tensei III '
      + '**Links:** [MAL](https://myanimelist.net/anime/59193/) | [AniList](https://anilist.co/anime/178789) '
      + '[Trailer](https://www.youtube.com/watch?v=SUZNsBQP4uI)',
    )

    expect(parsed).toEqual({
      synopsis: 'Third season of Mushoku Tensei.',
      score: 8.6,
      facts: [
        { label: 'Type', value: 'TV' },
        { label: 'Season', value: 'Summer 2026' },
        { label: 'Duration', value: '23m' },
        { label: 'Content rating', value: 'R - 17+ (violence & profanity)' },
        { label: 'Aired', value: 'Jul 6, 2026' },
        { label: 'Ended', value: 'Sep 28, 2026' },
      ],
      alternativeTitles: ['Mushoku Tensei III'],
      links: [
        { label: 'MAL', url: 'https://myanimelist.net/anime/59193/' },
        { label: 'AniList', url: 'https://anilist.co/anime/178789' },
        { label: 'Trailer', url: 'https://www.youtube.com/watch?v=SUZNsBQP4uI' },
      ],
    })
  })

  it('keeps normal HTML descriptions as plain synopsis text', () => {
    expect(parseCatalogDescription('<p>First &amp; safest.</p><p>Second paragraph.</p>')).toEqual({
      synopsis: 'First & safest.\n\nSecond paragraph.',
      facts: [],
      alternativeTitles: [],
      links: [],
    })
  })

  it('never exposes non-http source links', () => {
    const parsed = parseCatalogDescription('Story. **Links:** [Safe](https://example.com/a) | [Bad](javascript:alert(1))')
    expect(parsed.links).toEqual([{ label: 'Safe', url: 'https://example.com/a' }])
  })
})
