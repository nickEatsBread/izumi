import { describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import { catalogScreen } from '$lib/settings/catalog'
import { activeStudioThemeId, defaultStudioTheme, studioThemes } from '$lib/settings/theme-studio'
import { themePreset } from '$lib/settings/ui'
import { connecting, playing } from '$lib/player/session'
import { androidMiniPlayer } from '$lib/player/android-mpv'
import {
  activePlayerTheme, effectiveStudioTheme, effectiveThemePreset, playerTheme, resolveScreenTheme, screenThemeOptions, screenThemes, setScreenTheme,
  shownStudioTheme, shownThemePreset,
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

  it('paints with the player theme only while an episode opens or plays, and never moves the navigation theme', () => {
    const before = { screen: get(catalogScreen), themes: get(studioThemes), id: get(activeStudioThemeId), preset: get(themePreset), map: get(screenThemes), player: get(playerTheme) }
    try {
      studioThemes.set([defaultStudioTheme(0), marquee])
      activeStudioThemeId.set('izumi-studio')
      themePreset.set('sakura')
      catalogScreen.set('auto')
      playerTheme.set('design:installed-marquee')
      // Set but idle: the app theme paints.
      expect(get(activePlayerTheme)).toBeNull()
      expect(get(shownThemePreset)).toBe('sakura')
      connecting.set({ title: 'x', cancel: () => {} })
      expect(get(shownThemePreset)).toBe('custom')
      expect(get(shownStudioTheme).id).toBe('installed-marquee')
      // The navigation theme (layout, nav, Home) stays the app's.
      expect(get(effectiveThemePreset)).toBe('sakura')
      expect(get(effectiveStudioTheme).id).toBe('izumi-studio')
      connecting.set(null)
      playing.set(true)
      expect(get(shownStudioTheme).id).toBe('installed-marquee')
      // The Android mini-player docked over the browse UI is browsing.
      androidMiniPlayer.set(true)
      expect(get(shownThemePreset)).toBe('sakura')
      androidMiniPlayer.set(false)
      // A palette as the player theme; the default follows the app theme.
      playerTheme.set('midnight')
      expect(get(shownThemePreset)).toBe('midnight')
      playerTheme.set('')
      expect(get(shownThemePreset)).toBe('sakura')
      // A player theme whose design was removed follows the app theme.
      playerTheme.set('design:gone')
      expect(get(activePlayerTheme)).toBeNull()
    } finally {
      connecting.set(null)
      playing.set(false)
      androidMiniPlayer.set(false)
      catalogScreen.set(before.screen)
      studioThemes.set(before.themes)
      activeStudioThemeId.set(before.id)
      themePreset.set(before.preset)
      screenThemes.set(before.map)
      playerTheme.set(before.player)
    }
  })
})
