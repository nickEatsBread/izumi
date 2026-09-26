import { describe, expect, it } from 'vitest'
import { countryName, formatDate, mediaFacts, prettyEnum } from './facts'

const media = {
  id: 1, format: 'TV', status: 'RELEASING', episodes: 24, duration: 24, season: 'SPRING', seasonYear: 2026,
  source: 'LIGHT_NOVEL', countryOfOrigin: 'JP', averageScore: 83, popularity: 125000,
  startDate: { year: 2026, month: 4, day: 3 },
  studios: { nodes: [{ id: 7, name: '8-bit' }] }, title: { romaji: 'T' },
  genres: ['Action', 'Comedy'],
}

describe('series facts', () => {
  it('formats enum and date values', () => {
    expect(prettyEnum('LIGHT_NOVEL')).toBe('Light Novel')
    expect(countryName('JP')).toBe('Japan')
    expect(countryName('FR')).toBe('FR')
    expect(formatDate({ year: 2026, month: 4, day: 3 })).toBe('2026-4-3')
    expect(formatDate(null)).toBe('')
  })

  it('lists the standard facts in reading order, skipping unknown values', () => {
    const facts = mediaFacts(media as never)
    expect(facts.map((fact) => fact.key)).toEqual(['format', 'episodes', 'status', 'aired', 'season', 'duration', 'studio', 'source', 'country', 'score', 'members', 'genres'])
    expect(facts.find((fact) => fact.key === 'aired')?.value).toBe('2026-4-3')
    expect(facts.find((fact) => fact.key === 'studio')).toMatchObject({ value: '8-bit', href: '/app/studio/7' })
    expect(facts.find((fact) => fact.key === 'members')?.value).toMatch(/125/)
    expect(mediaFacts({ id: 2, title: { romaji: 'x' } } as never)).toEqual([])
  })

  it('adds a genres fact as the last entry, with one link per genre', () => {
    const facts = mediaFacts(media as never)
    expect(facts.at(-1)).toMatchObject({
      key: 'genres',
      label: 'Genres',
      value: 'Action, Comedy',
      links: [
        { text: 'Action', href: '/app/search?genre=Action' },
        { text: 'Comedy', href: '/app/search?genre=Comedy' },
      ],
    })
    expect(mediaFacts({ id: 2, title: { romaji: 'x' }, genres: [] } as never)).toEqual([])
  })
})
