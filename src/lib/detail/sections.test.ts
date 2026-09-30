import { describe, expect, it } from 'vitest'
import { desktopSynopsis, episodesOnPage, resolveSections, TAB_LABEL_TEXT } from './sections'

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
  it('keeps only the listed tabs when the unlisted sections are hidden', () => {
    // A site with Episodes, Relations and Recommendations and nothing else: no Overview, no Cast.
    const view = resolveSections({ tabs: ['episodes', 'relations', 'recommended'], unlisted: 'hidden' }, { phone: false, episodesTabbed: true })
    expect(view).toMatchObject({ tabs: ['episodes', 'relations', 'recommended'], folded: [], initial: 'episodes' })
    // An episode rail takes Episodes out of the tabs; the rest still stand alone.
    expect(resolveSections({ tabs: ['episodes', 'relations'], unlisted: 'hidden' }, { phone: false, episodesTabbed: false }).tabs).toEqual(['relations'])
  })
  it('names tabs from the fixed set only', () => {
    expect(Object.keys(TAB_LABEL_TEXT)).toHaveLength(14)
    expect(TAB_LABEL_TEXT.recommendations).toBe('Recommendations')
    expect(TAB_LABEL_TEXT['more-like-this']).toBe('More like this')
  })
})

// The Continue card sits at the top of the episode list, so it is on the page exactly when the list is.
describe('episodes on the page', () => {
  const phone = (sections?: Parameters<typeof resolveSections>[0], tabbed = true) => resolveSections(sections, { phone: true, episodesTabbed: tabbed })
  it('follows the open tab', () => {
    const view = phone({ tabs: ['overview', 'episodes'], default: 'overview' })
    expect(episodesOnPage(view, view.initial, false)).toBe(false)
    expect(episodesOnPage(view, 'episodes', false)).toBe(true)
    expect(episodesOnPage(phone(), 'episodes', false)).toBe(true)
    expect(episodesOnPage(phone(), 'relations', false)).toBe(false)
  })
  it('counts episodes folded into an open Overview', () => {
    const view = phone({ tabs: ['overview', 'relations'] })
    expect(view.folded).toContain('episodes')
    expect(episodesOnPage(view, 'overview', false)).toBe(true)
    expect(episodesOnPage(view, 'relations', false)).toBe(false)
  })
  it('is always true for stacked sections and for episodes outside the sections', () => {
    for (const open of ['overview', 'relations'] as const) {
      expect(episodesOnPage(phone({ mode: 'stack', tabs: ['overview', 'episodes'] }), open, false)).toBe(true)
      expect(episodesOnPage(phone({ mode: 'stack', tabs: ['overview'] }), open, false)).toBe(true)
      expect(episodesOnPage(phone({ tabs: ['overview', 'relations'] }, false), open, true)).toBe(true)
    }
  })
})

// The desktop info column (stacked and split pages) shows a synopsis; once a theme composes the
// sections, Overview must not repeat it.
describe('the desktop synopsis', () => {
  it("keeps izumi's short synopsis in the info column and the whole text in Overview without a theme's sections", () => {
    expect(desktopSynopsis(undefined)).toBe('both')
  })
  it('shows it once, in the info column, when a theme composes the sections', () => {
    expect(desktopSynopsis({ mode: 'stack' })).toBe('info')
    expect(desktopSynopsis({ tabs: ['overview', 'episodes'], default: 'overview' })).toBe('info')
    expect(desktopSynopsis({ info: 'above' })).toBe('info')
  })
  it('moves it into Overview with info: "overview"', () => {
    expect(desktopSynopsis({ mode: 'stack', tabs: ['overview', 'episodes'], info: 'overview' })).toBe('overview')
    expect(desktopSynopsis({ info: 'overview' })).toBe('overview')
  })
})
