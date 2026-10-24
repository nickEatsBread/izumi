import { describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import { catalogScreen } from '$lib/settings/catalog'
import { activeStudioThemeId, defaultStudioTheme, studioThemes } from '$lib/settings/theme-studio'
import { themePreset } from '$lib/settings/ui'
import {
  effectiveStudioTheme, effectiveThemePreset, resolveScreenTheme, screenThemeOptions, screenThemes, setScreenTheme,
} from './screen-theme'

const marquee = { ...defaultStudioTheme(0), id: 'installed-marquee', name: 'Marquee' }

describe('screen themes', () => {
  it('resolves a shipped palette, a saved design, and nothing for a missing design', () => {
    expect(resolveScreenTheme('midnight', [])).toEqual({ preset: 'midnight' })
    expect(resolveScreenTheme('design:installed-marquee', [marquee])).toEqual({ preset: 'custom', design: marquee })
    expect(resolveScreenTheme('design:gone', [marquee])).toBeNull()
    expect(resolveScreenTheme('custom', [marquee])).toBeNull()
    expect(resolveScreenTheme(undefined, [marquee])).toBeNull()
  })

  it('offers Same as app, the shipped palettes, then every saved design', () => {
    const options = screenThemeOptions([marquee])
    expect(options[0]).toEqual({ value: '', label: 'Same as app' })
    expect(options.map((option) => option.value)).toContain('izumi')
    expect(options.at(-1)).toEqual({ value: 'design:installed-marquee', label: 'Marquee' })
  })

  it("replaces the app theme only while the screen is active, and follows the app theme elsewhere", () => {
    const before = { screen: get(catalogScreen), themes: get(studioThemes), id: get(activeStudioThemeId), preset: get(themePreset), map: get(screenThemes) }
    try {
      studioThemes.set([defaultStudioTheme(0), marquee])
      activeStudioThemeId.set('izumi-studio')
      themePreset.set('sakura')
      setScreenTheme('tmdb', 'design:installed-marquee')
      catalogScreen.set('tmdb')
      expect(get(effectiveThemePreset)).toBe('custom')
      expect(get(effectiveStudioTheme).id).toBe('installed-marquee')
      catalogScreen.set('auto')
      expect(get(effectiveThemePreset)).toBe('sakura')
      expect(get(effectiveStudioTheme).id).toBe('izumi-studio')
      setScreenTheme('auto', 'izumi')
      expect(get(effectiveThemePreset)).toBe('izumi')
      setScreenTheme('auto', null)
      expect(get(screenThemes).auto).toBeUndefined()
      expect(get(effectiveThemePreset)).toBe('sakura')
    } finally {
      catalogScreen.set(before.screen)
      studioThemes.set(before.themes)
      activeStudioThemeId.set(before.id)
      themePreset.set(before.preset)
      screenThemes.set(before.map)
    }
  })
})
