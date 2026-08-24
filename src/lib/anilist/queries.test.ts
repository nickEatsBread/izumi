import { describe, it, expect } from 'vitest'
import { PAGE_QUERY, currentSeason, heroQuery } from './queries'
describe('currentSeason', () => {
  it('maps month to AniList season', () => {
    expect(currentSeason(new Date('2026-01-15')).season).toBe('WINTER')
    expect(currentSeason(new Date('2026-04-15')).season).toBe('SPRING')
    expect(currentSeason(new Date('2026-07-15')).season).toBe('SUMMER')
    expect(currentSeason(new Date('2026-10-15')).season).toBe('FALL')
    expect(currentSeason(new Date('2026-07-15')).seasonYear).toBe(2026)
  })
})

describe('catalogue projection', () => {
  it('does not attach full airing schedules to ordinary cards', () => {
    const query = PAGE_QUERY.loc?.source.body ?? ''
    expect(query).toContain('...CardMediaFields')
    expect(query).not.toContain('airingSchedule')
    expect(query).toMatch(/description\(asHtml:\s*false\)\s*@include\(if:\s*\$withPreview\)/)
  })

  it('keeps the hero projection bounded to its rendered discovery fields', () => {
    const query = heroQuery().loc?.source.body ?? ''
    expect(query).toContain('...HeroMediaFields')
    expect(query).toMatch(/airingSchedule\(perPage:\s*26\)/)
    expect(query).not.toContain('synonyms')
    expect(query).not.toContain('popularity')
  })
})
