import { describe, expect, it } from 'vitest'
import { desktopSynopsis, episodesOnPage, resolveSections, TAB_LABEL_TEXT } from './sections'

describe('series page sections', () => {
  it("keeps izumi's phone tabs without a theme", () => {
    const view = resolveSections(undefined, { phone: true, episodesTabbed: true })
    expect(view).toMatchObject({ mode: 'tabs', tabs: ['episodes', 'overview', 'relations', 'characters', 'recommended'], folded: [], initial: 'episodes', infoInOverview: false, information: 'overview' })
    expect(view.labels).toEqual({ episodes: 'Episodes', overview: 'Overview', relations: 'Relations', characters: 'Characters', recommended: 'Recommended', information: 'Information' })
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
    expect(Object.keys(TAB_LABEL_TEXT)).toHaveLength(16)
    expect(TAB_LABEL_TEXT['show-details']).toBe('Show Details')
    expect(TAB_LABEL_TEXT.recommendations).toBe('Recommendations')
    expect(TAB_LABEL_TEXT['more-like-this']).toBe('More like this')
  })
})

// API 4: the phone Overview's Information block is a section of its own only where a theme lists it.
describe('the Information section', () => {
  const phone = (sections?: Parameters<typeof resolveSections>[0]) => resolveSections(sections, { phone: true, episodesTabbed: true })
  it('stays inside Overview, where it always sits, when it is not listed', () => {
    for (const view of [phone(), phone({ tabs: ['overview', 'episodes'] }), phone({ mode: 'stack', tabs: ['overview', 'episodes'] })]) {
      expect(view.information).toBe('overview')
      // Never a tab, and never folded to the end of Overview.
      expect(view.tabs).not.toContain('information')
      expect(view.folded).not.toContain('information')
    }
  })
  it('becomes its own section at the listed position', () => {
    const stacked = phone({ mode: 'stack', tabs: ['overview', 'characters', 'episodes', 'information'], labels: { information: 'show-details' } })
    expect(stacked).toMatchObject({ mode: 'stack', tabs: ['overview', 'characters', 'episodes', 'information'], folded: ['relations', 'recommended'], information: 'section' })
    expect(stacked.labels.information).toBe('Show Details')
    const tabbed = phone({ tabs: ['information', 'episodes'], default: 'information' })
    expect(tabbed).toMatchObject({ tabs: ['information', 'episodes', 'overview'], initial: 'information', information: 'section' })
    expect(tabbed.labels.information).toBe('Information')
  })
  it('leaves the page with Overview, never on its own', () => {
    expect(phone({ tabs: ['episodes', 'relations'], unlisted: 'hidden' })).toMatchObject({ tabs: ['episodes', 'relations'], information: 'hidden' })
    expect(phone({ tabs: ['episodes', 'information'], unlisted: 'hidden' })).toMatchObject({ tabs: ['episodes', 'information'], information: 'section' })
    // A page that keeps Overview keeps the grid inside it, as it always did (an API 3 package's
    // `unlisted: "hidden"` hides only the sections it leaves out).
    expect(phone({ tabs: ['overview', 'episodes'], unlisted: 'hidden' })).toMatchObject({ tabs: ['overview', 'episodes'], information: 'overview' })
    expect(phone({ tabs: ['episodes', 'characters', 'relations', 'overview'], unlisted: 'hidden' }).information).toBe('overview')
  })
  it('leaves desktop pages as they are', () => {
    const view = resolveSections({ tabs: ['episodes', 'information', 'relations'] }, { phone: false, episodesTabbed: true })
    expect(view.tabs).toEqual(['episodes', 'relations', 'overview'])
    expect(view.folded).toEqual(['characters', 'recommended'])
    expect(view.information).toBe('overview')
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

describe('recommendations among the relations (API 4)', () => {
  it('drops the Recommended section on phones and desktop when they follow the relations', () => {
    const sections = { relations: { recommended: 'append' as const } }
    const phone = resolveSections(sections, { phone: true, episodesTabbed: true })
    expect(phone.tabs).toEqual(['episodes', 'overview', 'relations', 'characters'])
    expect(phone.recommendedInRelations).toBe(true)
    const desktop = resolveSections(sections, { phone: false, episodesTabbed: true })
    expect(desktop.tabs).toEqual(['episodes', 'relations', 'characters', 'overview'])
    // Never folded into Overview either.
    const listed = resolveSections({ tabs: ['overview', 'relations'], relations: { recommended: 'append' } }, { phone: true, episodesTabbed: true })
    expect(listed.folded).toEqual(['episodes', 'characters'])
  })
  it("keeps izumi's own Recommended section otherwise", () => {
    expect(resolveSections(undefined, { phone: true, episodesTabbed: true }).recommendedInRelations).toBe(false)
    const separate = resolveSections({ relations: { recommended: 'separate' } }, { phone: true, episodesTabbed: true })
    expect(separate.tabs).toContain('recommended')
    expect(separate.recommendedInRelations).toBe(false)
  })
})
