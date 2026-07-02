import { describe, it, expect } from 'vitest'
import { currentSeason } from './queries'
describe('currentSeason', () => {
  it('maps month to AniList season', () => {
    expect(currentSeason(new Date('2026-01-15')).season).toBe('WINTER')
    expect(currentSeason(new Date('2026-04-15')).season).toBe('SPRING')
    expect(currentSeason(new Date('2026-07-15')).season).toBe('SUMMER')
    expect(currentSeason(new Date('2026-10-15')).season).toBe('FALL')
    expect(currentSeason(new Date('2026-07-15')).seasonYear).toBe(2026)
  })
})
