import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { backdropTrailerOn } from './backdrop-trailer'
import { youtubeTrailerId } from './youtube-embed'

const on = { enabled: true, id: 'abc', setting: true, desktop: true, reducedMotion: false, saveData: false, playerUp: false, pageHidden: false, held: false }

describe('backdrop trailers', () => {
  it('plays only when the theme asks, there is a trailer and nothing holds it back', () => {
    expect(backdropTrailerOn(on)).toBe(true)
    for (const key of ['enabled', 'setting', 'desktop'] as const) expect(backdropTrailerOn({ ...on, [key]: false })).toBe(false)
    for (const key of ['reducedMotion', 'saveData', 'playerUp', 'pageHidden', 'held'] as const) expect(backdropTrailerOn({ ...on, [key]: true })).toBe(false)
    expect(backdropTrailerOn({ ...on, id: undefined })).toBe(false)
  })
  it('stops once the page scrolls past 100 px, on every page that hosts one, and loads after the host settles', () => {
    const source = readFileSync(new URL('./BackdropTrailer.svelte', import.meta.url), 'utf8')
    expect(source).toContain("const scrolledAway = () => typeof window !== 'undefined' && window.scrollY > 100")
    expect(source).toContain('held: held || scrolled || $trailerPopup !== null || $hoverTrailers > 0,')
    expect(source).toContain('<svelte:window onscroll={() => (scrolled = scrolledAway())} />')
    // Creating a YouTube player stalls the page, so it never lands inside a hero slide's cross-fade.
    expect(source).toContain('const preloadTimer = setTimeout(() => (mounted = true), Math.min(PRELOAD_MS, untrack(() => dwell)))')
  })
  it('takes YouTube trailers only', () => {
    expect(youtubeTrailerId({ id: 'x1', site: 'youtube' })).toBe('x1')
    expect(youtubeTrailerId({ id: 'x1', site: 'YouTube' })).toBe('x1')
    expect(youtubeTrailerId({ id: 'x1' })).toBe('x1')
    expect(youtubeTrailerId({ id: 'x1', site: 'dailymotion' })).toBeUndefined()
    expect(youtubeTrailerId(null)).toBeUndefined()
    expect(youtubeTrailerId(undefined)).toBeUndefined()
  })
})
