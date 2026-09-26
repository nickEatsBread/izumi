import { describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import {
  activeStudioThemeId,
  studioThemes,
  duplicateStudioTheme,
  defaultStudioTheme,
  hexToHslToken,
  hslTokenToHex,
  normalizeStudioTheme,
  parseStudioTheme,
  stringifyStudioTheme,
  tokenContrast,
  validHslToken,
} from './theme-studio'

describe('Theme Studio model', () => {
  it('can save a duplicate without applying it', () => {
    const previous = get(studioThemes)
    const active = get(activeStudioThemeId)
    try {
      const copy = duplicateStudioTheme(defaultStudioTheme(10), 20, false)
      expect(get(studioThemes).some(theme => theme.id === copy.id)).toBe(true)
      expect(get(activeStudioThemeId)).toBe(active)
    } finally {
      studioThemes.set(previous)
      activeStudioThemeId.set(active)
    }
  })

  it('round-trips display colours and accepts bounded HSL tokens', () => {
    for (const hex of ['#e93b69', '#09090b', '#fafafa', '#08b6cf']) {
      expect(hslTokenToHex(hexToHslToken(hex))).toBe(hex)
    }
    expect(validHslToken('346.6 79.1% 58%')).toBe(true)
    expect(validHslToken('20 120% 50%')).toBe(false)
  })

  it('normalizes unsafe imports and bounds visual controls', () => {
    const theme = normalizeStudioTheme({
      id: '../bad', name: '  ', radius: 99, fontScale: 0.1, glassBlur: 90,
      tokens: { ...defaultStudioTheme(0).tokens, background: 'url(bad)' },
    })
    expect(theme.id).toBe('izumi-studio')
    expect(theme.name).toBe('My Izumi')
    expect(theme.radius).toBe(2)
    expect(theme.fontScale).toBe(0.85)
    expect(theme.glassBlur).toBe(40)
    expect(theme.tokens.background).toBe(defaultStudioTheme().tokens.background)
  })

  it('exports a versioned portable theme and assigns imports a fresh id', () => {
    const original = { ...defaultStudioTheme(10), name: 'Cinema Night' }
    const imported = parseStudioTheme(stringifyStudioTheme(original), 20)
    expect(imported.name).toBe('Cinema Night (Imported)')
    expect(imported.id).toBe('theme-k-imported')
    expect(imported.tokens).toEqual(original.tokens)
  })

  it('reports accessible foreground contrast', () => {
    const theme = defaultStudioTheme()
    expect(tokenContrast(theme.tokens.foreground, theme.tokens.background)).toBeGreaterThanOrEqual(4.5)
    expect(tokenContrast('0 0% 50%', '0 0% 55%')).toBeLessThan(4.5)
  })

  it('keeps valid stylesheets and fonts on saved designs and drops invalid ones', () => {
    const kept = normalizeStudioTheme({ ...defaultStudioTheme(0), css: '.a{color:red}', fonts: { ui: 'inter' } })
    expect(kept.css).toBe('.a{color:red}')
    expect(kept.fonts).toEqual({ ui: 'inter' })
    const dropped = normalizeStudioTheme({ ...defaultStudioTheme(0), css: '@import "x.css";', fonts: { ui: 'nope' } })
    expect(dropped.css).toBeUndefined()
    expect(dropped.fonts).toBeUndefined()
  })
})
