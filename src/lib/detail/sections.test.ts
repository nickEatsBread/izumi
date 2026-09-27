import { describe, expect, it } from 'vitest'
import { resolveSections, TAB_LABEL_TEXT } from './sections'

describe('series page sections', () => {
  it("keeps izumi's phone tabs without a theme", () => {
    const view = resolveSections(undefined, { phone: true, episodesTabbed: true })
    expect(view).toMatchObject({ mode: 'tabs', tabs: ['episodes', 'overview', 'relations', 'characters', 'recommended'], folded: [], initial: 'episodes', infoInOverview: false })
    expect(view.labels).toEqual({ episodes: 'Episodes', overview: 'Overview', relations: 'Relations', characters: 'Characters', recommended: 'Recommended' })
  })
  it("keeps izumi's desktop tabs and names without a theme", () => {
    const view = resolveSections(undefined, { phone: false, episodesTabbed: true })
    expect(view.tabs).toEqual(['episodes', 'relations', 'characters', 'recommended', 'overview'])
    expect(view.labels).toMatchObject({ overview: 'Details', characters: 'Cast & Crew' })
  })
  it('opens on the first tab when the episodes sit beside or below the info', () => {
    expect(resolveSections(undefined, { phone: true, episodesTabbed: false })).toMatchObject({ tabs: ['overview', 'relations', 'characters', 'recommended'], initial: 'overview' })
    expect(resolveSections(undefined, { phone: false, episodesTabbed: false }).initial).toBe('relations')
  })
  it('gives listed sections tabs and folds the rest into Overview', () => {
    const view = resolveSections({ tabs: ['overview', 'episodes'], labels: { overview: 'info', episodes: 'watch' }, default: 'overview', info: 'overview' }, { phone: true, episodesTabbed: true })
    expect(view).toMatchObject({ tabs: ['overview', 'episodes'], folded: ['relations', 'characters', 'recommended'], initial: 'overview', infoInOverview: true })
    expect(view.labels).toMatchObject({ overview: 'Info', episodes: 'Watch', relations: 'Relations' })
    expect(resolveSections({ info: 'overview' }, { phone: false, episodesTabbed: true }).infoInOverview).toBe(false)
  })
  it('always keeps an Overview tab and drops episodes placed elsewhere', () => {
    expect(resolveSections({ tabs: ['episodes', 'relations'] }, { phone: true, episodesTabbed: true })).toMatchObject({ tabs: ['episodes', 'relations', 'overview'], folded: ['characters', 'recommended'] })
    expect(resolveSections({ tabs: ['episodes', 'overview'], default: 'episodes' }, { phone: true, episodesTabbed: false })).toMatchObject({ tabs: ['overview'], folded: ['relations', 'characters', 'recommended'], initial: 'overview' })
  })
  it('stacks every section in order when asked', () => {
    expect(resolveSections({ mode: 'stack', tabs: ['overview', 'characters', 'episodes'] }, { phone: true, episodesTabbed: true })).toMatchObject({ mode: 'stack', tabs: ['overview', 'characters', 'episodes'], folded: ['relations', 'recommended'] })
  })
  it('names tabs from the fixed set only', () => {
    expect(Object.keys(TAB_LABEL_TEXT)).toHaveLength(13)
    expect(TAB_LABEL_TEXT['more-like-this']).toBe('More like this')
  })
})
