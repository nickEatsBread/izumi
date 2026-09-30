import { describe, expect, it } from 'vitest'
import {
  addRecentSearch,
  advancedSearchHref,
  createSearchRequestGuard,
  normalizeSearchQuery,
  plainTextSynopsis,
  rankQuickSearchResults,
} from './global-search'
import type { Media } from '$lib/anilist/types'

const media = (
  id: number,
  english: string,
  options: { romaji?: string; synonyms?: string[]; popularity?: number; provider?: 'jvm' | 'stremio' } = {},
): Media => ({
  id,
  title: { english, romaji: options.romaji },
  synonyms: options.synonyms,
  popularity: options.popularity,
  ...(options.provider ? { catalog: { provider: options.provider, type: 'anime' as const, id: String(id) } } : {}),
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

  it('turns AniList description markup into compact plain text', () => {
    expect(plainTextSynopsis(
      'The Grand Line.<br><br><b>This includes:</b><br>Fish &amp; chips.',
    )).toBe('The Grand Line. This includes: Fish & chips.')
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
      // AniList really does give Onigiri the exact synonym "Demon Slayer".
      media(1, 'Onigiri', { synonyms: ['Demon Slayer', 'Demon Cutter'], popularity: 50_000 }),
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

  it('still finds titles through typos in the query', () => {
    const results = [
      media(1, 'Demon Slayer: Kimetsu no Yaiba'),
      media(2, 'Demon Slayer: Entertainment District Arc'),
    ]
    expect(rankQuickSearchResults(results, 'demn slayr')).toEqual(results)
  })

  it("drops a catalog's unrelated default listing instead of showing it for a typo", () => {
    // Some sources answer a query they cannot match with their front page.
    const results = rankQuickSearchResults([
      media(-1, 'You Shou Yan 6th Season', { provider: 'jvm' }),
      media(-2, 'Li Xiongmao', { provider: 'jvm' }),
      media(154587, 'Frieren: Beyond Journey’s End', { romaji: 'Sousou no Frieren' }),
    ], 'freiren')

    expect(results.map(({ id }) => id)).toEqual([154587])
  })

  it('keeps a source’s answer when nothing resembles the query: it may match a title the row does not show', () => {
    // An Aniyomi-only setup has no alternate titles to recognise "Shingeki no Kyojin" by.
    const results = [
      media(-1, 'Shingeki no Kyojin', { provider: 'jvm' }),
      media(-2, 'Shingeki no Kyojin Season 2', { provider: 'jvm' }),
    ]
    expect(rankQuickSearchResults(results, 'attack on titan')).toEqual(results)
  })

  it("keeps other catalogs' answers when nothing resembles the query: they may match a translated title", () => {
    const moneyHeist: Media = {
      id: -71446,
      title: { english: 'Money Heist', native: 'La casa de papel' },
      catalog: { provider: 'tmdb', type: 'series', id: '71446' },
    }
    expect(rankQuickSearchResults([moneyHeist], 'haus des geldes')).toEqual([moneyHeist])
  })

  it('keeps a catalog row titled in another language when that title names a match', () => {
    const results = rankQuickSearchResults([
      media(-3, 'Li Xiongmao', { provider: 'jvm' }),
      media(-4, 'Shingeki no Kyojin', { provider: 'jvm' }),
      media(16498, 'Attack on Titan', { romaji: 'Shingeki no Kyojin', popularity: 900_000 }),
    ], 'attack on titan')

    expect(results.map(({ id }) => id)).toEqual([16498, -4])
  })

  it('keeps an obscure synonym-only match out beside a far more popular title even for a typo', () => {
    const results = rankQuickSearchResults([
      media(1, 'Onigiri', { synonyms: ['Demon Slayer'], popularity: 3_600 }),
      media(3, 'Demon Slayer: Kimetsu no Yaiba', { popularity: 900_000 }),
    ], 'dmon slayer')

    expect(results.map(({ id }) => id)).toEqual([3])
  })

  it('keeps a series known by an abbreviation beside a spin-off whose own title contains it', () => {
    const results = rankQuickSearchResults([
      media(116741, 'The Slime Diaries: That Time I Got Reincarnated as a Slime', {
        romaji: 'Tensura Nikki: Tensei Shitara Slime Datta Ken', popularity: 13_540,
      }),
      media(101280, 'That Time I Got Reincarnated as a Slime', {
        romaji: 'Tensei Shitara Slime Datta Ken', synonyms: ['TenSura'], popularity: 466_043,
      }),
    ], 'tensura')

    expect(results.map(({ id }) => id)).toEqual([101280, 116741])
  })

  it('puts the widely watched title first among equally close typo matches', () => {
    const results = rankQuickSearchResults([
      media(1, 'Code Geass: Hangyaku no Lelouch DVD Magazine', { popularity: 4_000 }),
      media(2, 'Code Geass: Lelouch of the Rebellion', { popularity: 600_000 }),
    ], 'code gease')

    expect(results.map(({ id }) => id)).toEqual([2, 1])
  })

  it("leaves one or two typed letters in the catalogs' own order", () => {
    const results = [media(1, 'Akira'), media(2, 'Another', { provider: 'jvm' })]
    expect(rankQuickSearchResults(results, 'a')).toEqual(results)
  })
})
