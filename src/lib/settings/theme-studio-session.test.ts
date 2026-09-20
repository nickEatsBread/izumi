// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { themePreset } from './ui'
import { activeStudioTheme, activeStudioThemeId, defaultStudioTheme, saveStudioTheme, studioThemes, themeStudioPreview } from './theme-studio'
import { closeThemeStudio, currentStudioDesign, openThemeStudio, resetToShippedTheme, themeStudioMinimized, themeStudioOpen } from './theme-studio-session'
import { startThemeSync, THEME_PRESETS } from '$lib/theme'
import { previewTheme, themeInstallPreview } from '$lib/themes/installed'
import { parseThemePackage } from '$lib/themes/packages'

let stopSync: () => void
beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  studioThemes.set([defaultStudioTheme(0)])
  activeStudioThemeId.set('izumi-studio')
  themePreset.set('izumi')
  closeThemeStudio()
  stopSync = startThemeSync()
})

afterEach(() => {
  closeThemeStudio()
  stopSync()
  vi.unstubAllGlobals()
})

describe('Theme Studio live client session', () => {
  it('ends an installation preview before opening an editable draft', () => {
    previewTheme({ package: parseThemePackage({ app: 'izumi', kind: 'theme-package', schemaVersion: 1, themeApi: 1, id: 'test.preview', name: 'Preview', author: 'Test', description: 'Preview design.', version: '1.0.0', design: { radius: 1.8 } }), origin: 'https://example.test/theme.json' })
    openThemeStudio()
    expect(get(themeInstallPreview)).toBeNull()
    expect(get(themeStudioPreview)?.radius).toBe(currentStudioDesign().radius)
  })
  it('restores the exact shipped appearance and keeps it after closing, while retaining saved themes', () => {
    const shippedAppearance = document.documentElement.style.cssText
    saveStudioTheme({
      ...defaultStudioTheme(1), tokens: { ...THEME_PRESETS.light },
      font: 'serif', fontScale: 1.2, radius: 1.8, backdrop: 'mesh',
      backdropStrength: 0.6, glassBlur: 32,
    })
    themePreset.set('custom')
    const savedThemes = get(studioThemes)
    openThemeStudio()
    themeStudioPreview.set({ ...get(themeStudioPreview)!, tokens: { ...THEME_PRESETS.ocean } })

    const reset = resetToShippedTheme()
    expect(document.documentElement.style.cssText).toBe(shippedAppearance)
    expect(get(themePreset)).toBe('izumi')
    expect(get(themeStudioPreview)).toEqual(reset)
    expect(get(studioThemes)).toEqual(savedThemes)
    expect(reset).toMatchObject({ radius: 0.5, font: 'nunito', fontScale: 1, backdrop: 'solid', backdropStrength: 0, glassBlur: 0 })

    closeThemeStudio()
    expect(document.documentElement.style.cssText).toBe(shippedAppearance)
    openThemeStudio()
    expect(document.documentElement.style.cssText).toBe(shippedAppearance)
  })

  it.each(['izumi', 'midnight', 'sakura', 'ocean', 'light'] as const)('opens %s without changing the current client appearance', (preset) => {
    themePreset.set(preset)
    const before = document.documentElement.style.cssText
    openThemeStudio()
    expect(document.documentElement.style.cssText).toBe(before)
    expect(get(themeStudioPreview)?.tokens).toEqual(THEME_PRESETS[preset])
    expect(get(themePreset)).toBe(preset)
  })

  it('starts a system theme from the current OS scheme', () => {
    themePreset.set('system')
    expect(currentStudioDesign(false).tokens).toEqual(THEME_PRESETS.light)
    expect(currentStudioDesign(true).tokens).toEqual(THEME_PRESETS.izumi)
  })

  it('starts a custom theme from an independent copy of its saved controls', () => {
    const custom = { ...defaultStudioTheme(1), font: 'serif' as const, radius: 1.4 }
    saveStudioTheme(custom)
    themePreset.set('custom')
    openThemeStudio()
    expect(get(themeStudioPreview)).toEqual(get(activeStudioTheme))
    const copy = currentStudioDesign()
    copy.tokens.background = '0 0% 100%'
    expect(get(activeStudioTheme).tokens.background).toEqual(custom.tokens.background)
  })

  it('updates the real document immediately without persisting the draft', () => {
    openThemeStudio()
    const saved = get(activeStudioTheme)
    themeStudioPreview.set({
      ...get(themeStudioPreview)!, tokens: { ...THEME_PRESETS.ocean },
      font: 'serif', fontScale: 1.1, radius: 1.25,
      backdrop: 'mesh', backdropStrength: 0.4, glassBlur: 24,
    })
    const root = document.documentElement
    expect(root.style.getPropertyValue('--background')).toBe(THEME_PRESETS.ocean.background)
    expect(root.style.getPropertyValue('--theme')).toBe(THEME_PRESETS.ocean.theme)
    expect(root.style.getPropertyValue('--ui-font')).toContain('Georgia')
    expect(root.style.getPropertyValue('--theme-font-scale')).toBe('1.1')
    expect(root.style.getPropertyValue('--radius')).toBe('1.25rem')
    expect(root.style.getPropertyValue('--theme-glass-blur')).toBe('24px')
    expect(root.style.getPropertyValue('--theme-backdrop-strength')).toBe('0.4')
    expect(root.dataset.themeBackdrop).toBe('mesh')
    expect(get(activeStudioTheme)).toEqual(saved)
    expect(get(themePreset)).toBe('izumi')
  })

  it('preserves edits when the editor is minimized and reopened from another page', () => {
    openThemeStudio()
    const draft = { ...get(themeStudioPreview)!, tokens: { ...THEME_PRESETS.light } }
    themeStudioPreview.set(draft)
    themeStudioMinimized.set(true)
    openThemeStudio()
    expect(get(themeStudioPreview)).toEqual(draft)
    expect(get(themeStudioMinimized)).toBe(false)
    expect(document.documentElement.style.colorScheme).toBe('light')
  })

  it('discards a draft on close and restores the previously applied preset', () => {
    themePreset.set('midnight')
    const before = document.documentElement.style.cssText
    openThemeStudio()
    themeStudioPreview.set({ ...get(themeStudioPreview)!, tokens: { ...THEME_PRESETS.light }, fontScale: 1.2 })
    closeThemeStudio()
    expect(get(themeStudioOpen)).toBe(false)
    expect(get(themeStudioPreview)).toBeNull()
    expect(document.documentElement.style.cssText).toBe(before)
  })

  it('keeps saved changes applied after the editor closes', () => {
    openThemeStudio()
    const draft = { ...get(themeStudioPreview)!, tokens: { ...THEME_PRESETS.sakura }, radius: 1.2 }
    saveStudioTheme(draft)
    themePreset.set('custom')
    closeThemeStudio()
    expect(get(activeStudioTheme).tokens).toEqual(draft.tokens)
    expect(document.documentElement.style.getPropertyValue('--theme')).toBe(draft.tokens.theme)
    expect(document.documentElement.style.getPropertyValue('--radius')).toBe('1.2rem')
  })
})
