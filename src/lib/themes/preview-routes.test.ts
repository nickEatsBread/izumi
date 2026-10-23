import { describe, expect, it } from 'vitest'
import { newestSeriesId, screenOf, screenRoute, themePageUrl } from './preview-routes'

describe('theme preview routes', () => {
  it('opens each screen, and Home when no series is known', () => {
    expect(screenRoute('home', 5)).toBe('/app/home')
    expect(screenRoute('series', 5)).toBe('/app/anime/5')
    expect(screenRoute('series', null)).toBe('/app/home')
    expect(screenRoute('search', null)).toBe('/app/search')
    expect(screenRoute('schedule', null)).toBe('/app/schedule')
  })
  it('names the screen a path shows', () => {
    expect(screenOf('/app/home')).toBe('home')
    expect(screenOf('/app/anime/21')).toBe('series')
    expect(screenOf('/app/schedule/')).toBe('schedule')
    expect(screenOf('/app/library')).toBeNull()
  })
  it('picks the newest Continue Watching title', () => {
    expect(newestSeriesId([{ media: { id: 1 }, updatedAt: 5 }, { media: { id: 2 }, updatedAt: 9 }])).toBe(2)
    expect(newestSeriesId([])).toBeNull()
  })
  it('links back to the theme page, or to the store without a store id', () => {
    expect(themePageUrl('official', 'izumi.reel', 'search', 'desktop')).toBe('/app/settings/themes?store=official&theme=izumi.reel&screen=search&platform=desktop')
    expect(themePageUrl(undefined, 'izumi.reel')).toBe('/app/settings/themes')
  })
})
