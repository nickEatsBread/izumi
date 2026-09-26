import { get } from 'svelte/store'
import { describe, it, expect } from 'vitest'
import { showAdult } from '$lib/settings/ui'
import { LIST_PREVIEW_QUERY } from './lists'
import {
  MEDIA_BY_ID, SEARCH_QUERY, STAFF_MEDIA_QUERY, STUDIO_MEDIA_QUERY, searchQuery,
} from './detail-queries'
import {
  LOCAL_RECOMMENDATIONS_QUERY, PAGE_QUERY, PERSONAL_RECOMMENDATIONS_QUERY, RECENT_RELEASES_QUERY,
  currentSeason, heroQuery, homeSections, pageQuery,
} from './queries'
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
  it('uses GraphQL-valid nullable variables when a preview default is declared', () => {
    const previous = get(showAdult)
    showAdult.set(true)
    const documents = [
      PAGE_QUERY, pageQuery(), RECENT_RELEASES_QUERY, PERSONAL_RECOMMENDATIONS_QUERY, LOCAL_RECOMMENDATIONS_QUERY,
      MEDIA_BY_ID, SEARCH_QUERY, searchQuery(), STUDIO_MEDIA_QUERY, STAFF_MEDIA_QUERY,
      LIST_PREVIEW_QUERY,
    ]
    showAdult.set(previous)

    for (const document of documents) {
      const query = document.loc?.source.body ?? ''
      expect(query).toMatch(/\$withPreview:\s*Boolean\s*=\s*(?:true|false)/)
      expect(query).not.toMatch(/\$withPreview:\s*Boolean!\s*=/)
    }
  })

  it('keeps recommendation candidates explainable and supports account-free history seeds', () => {
    const accountQuery = PERSONAL_RECOMMENDATIONS_QUERY.loc?.source.body ?? ''
    const localQuery = LOCAL_RECOMMENDATIONS_QUERY.loc?.source.body ?? ''
    expect(accountQuery).toContain('score(format: POINT_100)')
    expect(accountQuery).toContain('MediaListCollection')
    expect(accountQuery).toContain('account: Page(page: 1, perPage: 10)')
    expect(accountQuery).not.toContain('$seedIds')
    expect(localQuery).toContain('history: Page(page: 1, perPage: 8)')
    expect(localQuery).toContain('media(id_in: $seedIds')
    expect(localQuery).toContain('recommendations(perPage: 7')
  })

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

  it('declares $format/$status as optional filters with no default, so an omitted preset value stays omitted', () => {
    const previous = get(showAdult)
    showAdult.set(true)
    const allQuery = pageQuery().loc?.source.body ?? ''
    showAdult.set(previous)
    const query = PAGE_QUERY.loc?.source.body ?? ''
    for (const body of [query, allQuery]) {
      expect(body).toMatch(/\$format:\s*MediaFormat[,)]/)
      expect(body).toMatch(/\$status:\s*MediaStatus[,)]/)
      expect(body).toContain('format: $format')
      expect(body).toContain('status: $status')
    }
  })
})

describe('homeSections presets', () => {
  it('adds Newest, Popular Movies and Top Rated after All Time Popular', () => {
    const keys = homeSections(new Date('2026-01-15')).map((section) => section.key)
    expect(keys.slice(keys.indexOf('popular'), keys.indexOf('popular') + 4)).toEqual([
      'popular', 'newest', 'movies', 'rated',
    ])
  })

  it('filters Newest to currently-airing titles, newest start date first', () => {
    const section = homeSections(new Date('2026-01-15')).find((item) => item.key === 'newest')
    expect(section).toMatchObject({ title: 'Newest', vars: { sort: ['START_DATE_DESC'], status: 'RELEASING' } })
  })

  it('filters Popular Movies to the MOVIE format', () => {
    const section = homeSections(new Date('2026-01-15')).find((item) => item.key === 'movies')
    expect(section).toMatchObject({ title: 'Popular Movies', vars: { sort: ['POPULARITY_DESC'], format: 'MOVIE' } })
  })

  it('sorts Top Rated by score without a format/status filter', () => {
    const section = homeSections(new Date('2026-01-15')).find((item) => item.key === 'rated')
    expect(section).toMatchObject({ title: 'Top Rated', vars: { sort: ['SCORE_DESC'] } })
    expect(section?.vars).not.toHaveProperty('format')
    expect(section?.vars).not.toHaveProperty('status')
  })

  it('only sets format/status on the presets that actually filter by them', () => {
    for (const section of homeSections(new Date('2026-01-15'))) {
      expect('format' in section.vars).toBe(section.key === 'movies')
      expect('status' in section.vars).toBe(section.key === 'newest')
    }
  })
})
