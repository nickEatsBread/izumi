import { describe, expect, it } from 'vitest'
import { findAnimeAwardWins, findTopAnimeAward, normalizeAwardTitle } from './anime-awards'
import { classifyAward, namedProviderAward, summarizeAwardBindings } from './awards'

describe('catalogue award metadata', () => {
  it('matches punctuation and typography variants without fuzzy false positives', () => {
    expect(normalizeAwardTitle('SPY × FAMILY Season 3')).toBe(normalizeAwardTitle('Spy x Family Season 3'))
    expect(findTopAnimeAward('Jujutsu Kaisen')).toMatchObject({ year: 2024, category: 'Anime of the Year' })
    expect(findAnimeAwardWins('My Hero Academia')).toContainEqual(expect.objectContaining({ year: 2026, category: 'Anime of the Year' }))
    expect(findAnimeAwardWins('An unrelated title')).toEqual([])
  })

  it('classifies major award families and removes a nomination duplicated by a win', () => {
    expect(classifyAward('Primetime Emmy Award for Outstanding Drama Series')).toBe('emmy')
    expect(classifyAward('Golden Globe Award for Best Television Series')).toBe('golden-globe')
    expect(summarizeAwardBindings([
      { awardLabel: { value: 'Primetime Emmy Award for Outstanding Drama Series' }, result: { value: 'won' } },
      { awardLabel: { value: 'Primetime Emmy Award for Outstanding Drama Series' }, result: { value: 'nominated' } },
      { awardLabel: { value: 'Primetime Emmy Award for Outstanding Writing' }, result: { value: 'nominated' } },
    ])).toEqual([{
      family: 'emmy',
      label: 'Primetime Emmy',
      wins: 1,
      nominations: 1,
      recognitions: [
        { label: 'Primetime Emmy Award for Outstanding Drama Series', result: 'winner' },
        { label: 'Primetime Emmy Award for Outstanding Writing', result: 'nominee' },
      ],
    }])
  })

  it('keeps the name of specific festivals and juried prizes', () => {
    expect(summarizeAwardBindings([
      { awardLabel: { value: 'Sundance Film Festival Grand Jury Prize' }, result: { value: 'won' } },
    ])).toEqual([{
      family: 'other',
      label: 'Sundance Film Festival Grand Jury Prize',
      wins: 1,
      nominations: 0,
      recognitions: [{ label: 'Sundance Film Festival Grand Jury Prize', result: 'winner' }],
    }])
  })

  it('never presents an unnamed provider total as award context', () => {
    expect(namedProviderAward('7 wins & 15 nominations total')).toBe('')
    expect(namedProviderAward('Won 2 Primetime Emmys. 31 wins & 70 nominations total')).toBe('')
    expect(namedProviderAward('Sundance Film Festival Grand Jury Prize for Dramatic Film. 3 wins total')).toBe('Sundance Film Festival Grand Jury Prize for Dramatic Film')
  })
})
