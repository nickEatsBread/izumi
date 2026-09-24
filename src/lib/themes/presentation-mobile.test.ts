import { describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import { parsePresentation, resolvePresentation, themeCoverage } from './presentation'

const shared = {
  density: 'comfortable',
  shell: { nav: 'top' },
  hero: { height: 50, interval: 12, template: { type: 'text', field: 'title' } },
  rows: { defaults: { width: 160, gap: 12 }, byId: { continue: { aspect: 'landscape' }, trending: { width: 200 } } },
  detail: { layout: 'split', posterWidth: 200, episodes: { placement: 'right', arrangement: 'list' } },
  cards: { poster: { type: 'text', field: 'title' }, continue: { type: 'text', field: 'episodeTitle' } },
  mobile: {
    density: 'compact',
    hero: { height: 34, template: { type: 'artwork', artwork: 'poster' } },
    rows: { defaults: { width: 120 }, byId: { continue: { aspect: 'square' } } },
    detail: { layout: 'stack', episodes: { arrangement: 'grid' } },
    cards: { poster: { type: 'artwork', artwork: 'poster' } },
  },
} as const

describe('phone presentation overrides', () => {
  it('accepts a mobile block with the shared surface keys only', () => {
    const parsed = parsePresentation(shared)
    expect(parsed.mobile?.density).toBe('compact')
    expect(parsed.mobile?.hero?.height).toBe(34)
    expect(() => parsePresentation({ mobile: { shell: { nav: 'top' } } })).toThrow()
    expect(() => parsePresentation({ mobile: { mobile: { density: 'compact' } } })).toThrow()
    expect(() => parsePresentation({ mobile: { hero: { height: 5 } } })).toThrow()
  })

  it('layers the mobile block over the shared layout on phones only', () => {
    const parsed = parsePresentation(shared)
    const desktop = resolvePresentation(parsed, false)!
    expect(desktop.mobile).toBeUndefined()
    expect(desktop.density).toBe('comfortable')
    expect(desktop.hero?.height).toBe(50)
    expect(desktop.rows?.byId?.continue).toEqual({ aspect: 'landscape' })

    const phone = resolvePresentation(parsed, true)!
    expect(phone.mobile).toBeUndefined()
    expect(phone.density).toBe('compact')
    // One level deep: the phone hero keeps the shared interval and swaps the template.
    expect(phone.hero).toMatchObject({ height: 34, interval: 12, template: { type: 'artwork', artwork: 'poster' } })
    expect(phone.rows?.defaults).toEqual({ width: 120, gap: 12 })
    // Row overrides replace their shared entry whole; untouched rows survive.
    expect(phone.rows?.byId).toEqual({ continue: { aspect: 'square' }, trending: { width: 200 } })
    expect(phone.detail).toMatchObject({ layout: 'stack', posterWidth: 200, episodes: { placement: 'right', arrangement: 'grid' } })
    expect(phone.cards?.poster).toEqual({ type: 'artwork', artwork: 'poster' })
    expect(phone.cards?.continue).toEqual({ type: 'text', field: 'episodeTitle' })
    // Shell never comes from the phone block: phones already use the bottom bar.
    expect(phone.shell).toEqual({ nav: 'top' })
  })

  it('leaves layouts without a mobile block untouched', () => {
    const parsed = parsePresentation({ density: 'large' })
    expect(resolvePresentation(parsed, true)).toBe(parsed)
    expect(resolvePresentation(undefined, true)).toBeUndefined()
  })

  it('counts phone-only surfaces towards coverage', () => {
    expect(themeCoverage(parsePresentation({ mobile: { detail: { layout: 'stack' } } }))).toEqual(['Details'])
  })

  it('resolves the runtime presentation against the mobile platform store', async () => {
    const [{ themePresentation }, { isMobile }, { studioThemes, activeStudioThemeId }, { themePreset }] = await Promise.all([
      import('./runtime'), import('$lib/platform'), import('$lib/settings/theme-studio'), import('$lib/settings/ui'),
    ])
    const design = { id: 'phone-test', name: 'Phone test', createdAt: 1, updatedAt: 1, tokens: {}, radius: 0.5, font: 'nunito', fontScale: 1, backdrop: 'solid', backdropStrength: 0, glassBlur: 0, presentation: shared }
    studioThemes.update((themes) => [...themes.filter((theme) => theme.id !== design.id), design as never])
    activeStudioThemeId.set(design.id)
    themePreset.set('custom')
    isMobile.set(false)
    expect(get(themePresentation)?.density).toBe('comfortable')
    isMobile.set(true)
    expect(get(themePresentation)?.density).toBe('compact')
    expect(get(themePresentation)?.hero?.height).toBe(34)
    isMobile.set(false)
    themePreset.set('izumi')
  })
})
