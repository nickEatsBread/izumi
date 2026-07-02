import { describe, it, expect } from 'vitest'
import { searchVariables } from './detail-queries'
describe('searchVariables', () => {
  it('omits empty filters and passes provided ones', () => {
    const v = searchVariables({ search: 'frieren', genres: ['Action'], season: '', year: 2026, formats: [], sort: 'SEARCH_MATCH' })
    expect(v.search).toBe('frieren'); expect(v.genre_in).toEqual(['Action'])
    expect(v.seasonYear).toBe(2026); expect('season' in v).toBe(false); expect('format_in' in v).toBe(false)
  })
})
