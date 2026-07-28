import { describe, expect, it } from 'vitest'
import {
  addRecentSearch,
  advancedSearchHref,
  createSearchRequestGuard,
  normalizeSearchQuery,
  rankQuickSearchResults,
} from './global-search'
import type { Media } from '$lib/anilist/types'

const media = (
  id: number,
  english: string,
  options: { romaji?: string; synonyms?: string[]; popularity?: number } = {},
): Media => ({
  id,
  title: { english, romaji: options.romaji },
  synonyms: options.synonyms,
  popularity: options.popularity,
})

describe('global search helpers', () => {
  it('normalizes surrounding and repeated whitespace', () => {
    expect(normalizeSearchQuery('  Fullmetal   Alchemist  ')).toBe('Fullmetal Alchemist')
  })

  it('deduplicates recent searches case-insensitively and keeps the newest spelling', () => {
    expect(addRecentSearch(['Frieren', 'One Piece', 'Monster'], '  one piece ')).toEqual([
      'one piece',
      'Frieren',
      'Monster',
    ])
  })

  it('caps recent searches', () => {
    expect(addRecentSearch(['b', 'c', 'd'], 'a', 3)).toEqual(['a', 'b', 'c'])
  })

  it('builds an advanced-search link without emitting an empty query', () => {
    expect(advancedSearchHref('')).toBe('/app/search')
    expect(advancedSearchHref('Cowboy Bebop')).toBe('/app/search?search=Cowboy%20Bebop')
  })

  it('rejects stale asynchronous requests', () => {
    const guard = createSearchRequestGuard()
    const first = guard.begin()
    const second = guard.begin()
    expect(guard.isCurrent(first)).toBe(false)
    expect(guard.isCurrent(second)).toBe(true)
    guard.invalidate()
    expect(guard.isCurrent(second)).toBe(false)
  })

  it('puts the direct Demon Slayer title above unrelated fuzzy API results', () => {
    const results = rankQuickSearchResults([
      media(1, 'Onigiri', { popularity: 50_000 }),
      media(2, 'Demon Slayer -Kimetsu no Yaiba- The Movie: Mugen Train', { popularity: 400_000 }),
      media(3, 'Demon Slayer: Kimetsu no Yaiba', { popularity: 900_000 }),
      media(4, 'Junior High and High School!! Kimetsu Academy Story'),
    ], 'demon slayer')

    expect(results.map(({ id }) => id)).toEqual([3, 2])
  })

  it('matches alternate titles and synonyms', () => {
    const results = rankQuickSearchResults([
      media(1, 'Onigiri'),
      media(2, 'Kimetsu no Yaiba', { synonyms: ['Demon Slayer'] }),
    ], 'demon slayer')

    expect(results.map(({ id }) => id)).toEqual([2])
  })

  it('keeps AniList fuzzy ordering when no returned title text matches a typo', () => {
    const results = [
      media(1, 'Demon Slayer: Kimetsu no Yaiba'),
      media(2, 'Demon Slayer: Entertainment District Arc'),
    ]
    expect(rankQuickSearchResults(results, 'demn slayr')).toEqual(results)
  })
})
