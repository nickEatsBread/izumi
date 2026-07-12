import { describe, it, expect } from 'vitest'
import { searchVariables } from './detail-queries'
describe('searchVariables', () => {
  it('omits empty filters and passes provided ones', () => {
    const v = searchVariables({ search: 'frieren', genres: ['Action'], season: '', year: 2026, formats: [], sort: 'SEARCH_MATCH' })
    expect(v.search).toBe('frieren'); expect(v.genre_in).toEqual(['Action'])
    expect(v.seasonYear).toBe(2026); expect('season' in v).toBe(false); expect('format_in' in v).toBe(false)
  })

  it('maps advanced tag/source/country filters and guards empties', () => {
    const v = searchVariables({ tagsIn: ['Isekai'], tagsNotIn: ['Gore'], sources: ['MANGA'], country: 'JP', minTagRank: 60 })
    expect(v.tag_in).toEqual(['Isekai']); expect(v.tag_not_in).toEqual(['Gore'])
    expect(v.source_in).toEqual(['MANGA']); expect(v.countryOfOrigin).toBe('JP'); expect(v.minimumTagRank).toBe(60)
    const empty = searchVariables({ tagsIn: [], tagsNotIn: [], sources: [], country: '' })
    expect('tag_in' in empty).toBe(false); expect('tag_not_in' in empty).toBe(false)
    expect('source_in' in empty).toBe(false); expect('countryOfOrigin' in empty).toBe(false)
  })

  it('translates inclusive score / episode bounds to AniList strict comparisons', () => {
    const v = searchVariables({ minScore: 75, epMin: 12, epMax: 24 })
    expect(v.averageScore_greater).toBe(74)  // >=75 → _greater 74
    expect(v.episodes_greater).toBe(11)       // >=12 → _greater 11
    expect(v.episodes_lesser).toBe(25)        // <=24 → _lesser 25
    // epMin=0 is still applied (episodes_greater -1, a harmless no-op); minScore 0 is skipped.
    const edge = searchVariables({ epMin: 0, minScore: 0 })
    expect(edge.episodes_greater).toBe(-1); expect('averageScore_greater' in edge).toBe(false)
  })
})
