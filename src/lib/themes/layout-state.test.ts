import { get } from 'svelte/store'
import { beforeEach, describe, expect, it } from 'vitest'
import { activeStudioThemeId, studioThemes, themeStudioPreview, defaultStudioTheme } from '$lib/settings/theme-studio'
import { themePreset } from '$lib/settings/ui'
import { activeThemeKey, activeThemeLayout, offeredThemeLayout, setThemeLayoutEnabled, themeLayoutEnabled } from './layout-state'

const design = (id: string, layout?: object) => ({ ...defaultStudioTheme(0), id, name: `Theme ${id}`, presentation: layout ? { layout } : {} })

describe('theme layout state', () => {
  beforeEach(() => {
    themeStudioPreview.set(null)
    themeLayoutEnabled.set({})
    studioThemes.set([design('a', { home: [{ role: 'hero' }] }), design('b')] as never)
    activeStudioThemeId.set('a')
    themePreset.set('custom')
  })

  it('applies the active theme layout until its switch is turned off', () => {
    expect(get(activeThemeKey)).toBe('a')
    expect(get(offeredThemeLayout)?.home).toEqual([{ role: 'hero' }])
    expect(get(activeThemeLayout)?.home).toEqual([{ role: 'hero' }])
    setThemeLayoutEnabled('a', false)
    expect(get(activeThemeLayout)).toBeNull()
    expect(get(offeredThemeLayout)).not.toBeNull()
  })

  it('offers nothing for built-in presets or themes without a layout', () => {
    themePreset.set('izumi')
    expect(get(activeThemeLayout)).toBeNull()
    themePreset.set('custom')
    activeStudioThemeId.set('b')
    expect(get(activeThemeLayout)).toBeNull()
  })

  it('previews a design with its layout', () => {
    themePreset.set('izumi')
    themeStudioPreview.set(design('p', { home: [{ role: 'continue' }] }) as never)
    expect(get(activeThemeKey)).toBe('p')
    expect(get(activeThemeLayout)?.home).toEqual([{ role: 'continue' }])
  })
})
