import { describe, expect, it } from 'vitest'
import { TAB_LABEL_TEXT } from '$lib/detail/sections'
import { parsePresentation, resolvePresentation, shellNavFor, themeCoverage } from './presentation'

describe('TV block (API 6)', () => {
  it('parses a TV variant with its own navigation, rows, hero, player and preview choice', () => {
    const tv = {
      density: 'large',
      shell: { nav: 'top', top: { labels: 'text' } },
      rows: { defaults: { width: 300, caption: 'focus' } },
      hero: { height: 70 },
      player: { seekbarHeight: 8 },
      cardPreview: 'none',
      layout: { home: [{ role: 'hero' }, { role: 'trending' }] },
    }
    expect(parsePresentation({ tv }).tv).toEqual(tv)
  })

  it('is refused before API 6 and keeps phone-only and nested blocks out', () => {
    expect(() => parsePresentation({ tv: { density: 'large' } }, 5)).toThrow('unsupported')
    expect(() => parsePresentation({ tv: { rootSize: 16 } })).toThrow('unsupported')
    expect(() => parsePresentation({ tv: { mobile: {} } })).toThrow('unsupported')
    expect(() => parsePresentation({ tv: { tv: {} } })).toThrow('unsupported')
    expect(() => parsePresentation({ mobile: { tv: {} } })).toThrow('unsupported')
  })

  it('validates what it carries with the same rules as the top level', () => {
    expect(() => parsePresentation({ tv: { shell: { nav: 'floating' } } })).toThrow('unsupported')
    expect(() => parsePresentation({ tv: { rows: { defaults: { width: 9000 } } } })).toThrow()
  })
})

describe('resolving the TV block', () => {
  const layout = parsePresentation({
    density: 'comfortable',
    shell: { nav: 'top', top: { labels: 'text', search: 'icon' }, hints: true },
    hero: { height: 50, interval: 8 },
    rows: { defaults: { width: 200, gap: 8 }, byId: { trending: { width: 180 } } },
    mobile: { density: 'compact' },
    tv: {
      density: 'large',
      shell: { nav: 'sidebar', top: { labels: 'both' } },
      hero: { height: 70 },
      rows: { defaults: { width: 300 } },
    },
  })

  it('layers the TV block one level deep on a TV surface', () => {
    const tv = resolvePresentation(layout, false, true)
    expect(tv?.density).toBe('large')
    expect(tv?.hero).toEqual({ height: 70, interval: 8 })
    expect(tv?.rows?.defaults).toEqual({ width: 300, gap: 8 })
    expect(tv?.rows?.byId).toEqual({ trending: { width: 180 } })
    // The shell merges one level deep, and its top bar one more, so `hints` and `search` survive.
    expect(tv?.shell).toEqual({ nav: 'sidebar', top: { labels: 'both', search: 'icon' }, hints: true })
    expect(tv?.tv).toBeUndefined()
    expect(tv?.mobile).toBeUndefined()
  })

  it('lets the phone block win on a phone and drops the TV block everywhere else', () => {
    expect(resolvePresentation(layout, true, true)?.density).toBe('compact')
    expect(resolvePresentation(layout, true, true)?.tv).toBeUndefined()
    const desktop = resolvePresentation(layout, false, false)
    expect(desktop?.density).toBe('comfortable')
    expect(desktop?.tv).toBeUndefined()
    expect(desktop?.mobile).toBeUndefined()
    // A presentation with only a TV block loses it off TV surfaces too.
    const tvOnly = parsePresentation({ density: 'compact', tv: { density: 'large' } })
    expect(resolvePresentation(tvOnly, false)).toEqual({ density: 'compact' })
    expect(resolvePresentation(tvOnly, false, true)).toEqual({ density: 'large' })
  })

  it('lets a TV layout carry its own navigation (unlike the phone block)', () => {
    const nav = { home: 1, top: ['search'] }
    expect(parsePresentation({ tv: { layout: { nav } } }).tv?.layout?.nav).toEqual(nav)
    expect(() => parsePresentation({ mobile: { layout: { nav } } })).toThrow('unsupported')
  })

  it('places the navigation for each surface', () => {
    const top = parsePresentation({ shell: { nav: 'top' } })
    const tvTop = parsePresentation({ tv: { shell: { nav: 'top' } } })
    // Phones always use the bottom bar.
    expect(shellNavFor(true, false, tvTop, resolvePresentation(tvTop, true))).toBe('bottom')
    // An Android TV keeps its rail unless the TV block itself asks for the top bar.
    expect(shellNavFor(false, true, top, resolvePresentation(top, false, true))).toBe('sidebar')
    expect(shellNavFor(false, true, tvTop, resolvePresentation(tvTop, false, true))).toBe('top')
    // Desktop and Game mode follow the resolved shell.
    expect(shellNavFor(false, false, top, resolvePresentation(top, false))).toBe('top')
    expect(shellNavFor(false, false, tvTop, resolvePresentation(tvTop, false, true))).toBe('top')
    expect(shellNavFor(false, false, undefined, undefined)).toBe('sidebar')
  })

  it('counts what the TV block styles in the coverage chips', () => {
    expect(themeCoverage(parsePresentation({ tv: { hero: { height: 70 } } }))).toEqual(['Home'])
    expect(themeCoverage(parsePresentation({ tv: { shell: { nav: 'top' } } }))).toEqual(['Shell'])
    expect(themeCoverage(parsePresentation({ tv: { detail: { layout: 'overlay' } } }))).toEqual(['Details'])
    expect(themeCoverage(parsePresentation({ tv: { player: { seekbarHeight: 8 } } }))).toEqual(['Player'])
  })
})

describe('Suggested tab name (API 6)', () => {
  it('names the Recommended section Suggested from API 6 only', () => {
    const sections = { tabs: ['episodes', 'recommended', 'overview'], labels: { recommended: 'suggested', overview: 'details' } }
    expect(parsePresentation({ detail: { sections } }).detail?.sections?.labels).toEqual(sections.labels)
    expect(() => parsePresentation({ detail: { sections } }, 5)).toThrow('unsupported')
    expect(() => parsePresentation({ detail: { sections: { labels: { episodes: 'suggested' } } } })).toThrow('unsupported')
    expect(TAB_LABEL_TEXT.suggested).toBe('Suggested')
  })
})
