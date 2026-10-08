import { describe, expect, it } from 'vitest'
import { themeHeaderIds, themeNavConfig } from './theme-nav'

describe('theme navigation', () => {
  it('places the listed destinations and hides the rest', () => {
    expect(themeNavConfig({ bottom: ['schedule', 'library'], top: ['search'] }, ['schedule', 'downloads', 'search', 'library'])).toEqual([
      { id: 'schedule', placement: 'bottom' }, { id: 'library', placement: 'bottom' }, { id: 'search', placement: 'top' }, { id: 'downloads', placement: 'hidden' },
    ])
    expect(themeNavConfig({ home: 1 }, ['schedule'])).toBeNull()
  })

  // API 4: a header icon may repeat a bottom-bar tab. The config keeps one entry per destination (the
  // tab), so the bar and Settings -> Navigation, which key their lists by destination, never see it twice.
  it('keeps a destination listed on both as one bottom-bar entry', () => {
    const known = ['schedule', 'downloads', 'search', 'library']
    const config = themeNavConfig({ bottom: ['search', 'library'], top: ['search', 'downloads'] }, known)
    expect(config).toEqual([
      { id: 'search', placement: 'bottom' }, { id: 'library', placement: 'bottom' }, { id: 'downloads', placement: 'top' }, { id: 'schedule', placement: 'hidden' },
    ])
    expect(new Set(config!.map((item) => item.id)).size).toBe(config!.length)
  })

  it("puts the theme's own header list in the phone Home header, repeats included", () => {
    const known = ['schedule', 'downloads', 'search', 'settings']
    expect(themeHeaderIds({ bottom: ['search'], top: ['search', 'downloads'] }, known, ['downloads'])).toEqual(['search', 'downloads'])
    // A destination the config pinned to the top (Settings) follows the theme's list, once.
    expect(themeHeaderIds({ bottom: ['search'], top: ['search'] }, known, ['settings'])).toEqual(['search', 'settings'])
    // Without a theme list the header is the config's own top destinations.
    expect(themeHeaderIds({ bottom: ['search'] }, known, ['downloads'])).toEqual(['downloads'])
    expect(themeHeaderIds(undefined, known, ['schedule'])).toEqual(['schedule'])
    expect(themeHeaderIds({ top: ['search', 'letterboxd'] }, known, [])).toEqual(['search'])
  })
})
