import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { get } from 'svelte/store'
import { describe, expect, it } from 'vitest'
import { defaultStudioTheme, studioThemes, activeStudioThemeId } from '$lib/settings/theme-studio'
import { themePreset } from '$lib/settings/ui'
import { MAX_THEME_SCREENS, parsePresentation, resolvePresentation } from './presentation'
import { themeLayoutEnabled, themeScreens } from './layout-state'

const home = [{ role: 'trending' }, { block: 'genre-chips', genres: 'top' }]
const screen = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: `Screen ${id}`, home, ...extra })
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

describe('theme screens (API 8)', () => {
  it('parses screens on API 8 packages only', () => {
    const layout = { screens: [screen('picks', { icon: 'star' })] }
    expect(parsePresentation({ layout }, 8).layout?.screens).toEqual([{ id: 'picks', title: 'Screen picks', icon: 'star', home: [{ role: 'trending' }, { block: 'genre-chips', genres: 'top', area: 'main', phone: false, all: true }] }])
    expect(() => parsePresentation({ layout }, 7)).toThrow('unsupported')
  })
  it('enforces the limit of four and refuses bad screens', () => {
    expect(MAX_THEME_SCREENS).toBe(4)
    expect(parsePresentation({ layout: { screens: ['a', 'b', 'c', 'd'].map((id) => screen(id)) } }).layout?.screens).toHaveLength(4)
    expect(() => parsePresentation({ layout: { screens: ['a', 'b', 'c', 'd', 'e'].map((id) => screen(id)) } })).toThrow('up to 4 screens')
    expect(() => parsePresentation({ layout: { screens: [] } })).toThrow()
    for (const bad of [screen('Picks'), screen('-x'), screen('a'.repeat(25)), screen('ok', { title: '' }), screen('ok', { title: 'x'.repeat(25) }), screen('ok', { icon: 'rocket' }), screen('ok', { home: [] }), screen('ok', { home: [{ role: 'hero' }, { role: 'hero' }] }), screen('ok', { script: 'x' })]) {
      expect(() => parsePresentation({ layout: { screens: [bad] } }), JSON.stringify(bad)).toThrow()
    }
    expect(() => parsePresentation({ layout: { screens: [screen('a'), screen('a')] } })).toThrow('twice')
  })
  it('keeps screens out of the phone block, which shows the shared ones', () => {
    expect(() => parsePresentation({ mobile: { layout: { screens: [screen('a')] } } })).toThrow()
    const shared = parsePresentation({ layout: { screens: [screen('a')] }, mobile: { layout: { home } }, tv: { layout: { screens: [screen('tv')] } } })
    expect(resolvePresentation(shared, true)?.layout?.screens?.map((entry) => entry.id)).toEqual(['a'])
    expect(resolvePresentation(shared, false, true)?.layout?.screens?.map((entry) => entry.id)).toEqual(['tv'])
  })
  it("offers the active theme's screens while its layout switch is on", () => {
    const before = { themes: get(studioThemes), id: get(activeStudioThemeId), preset: get(themePreset), enabled: get(themeLayoutEnabled) }
    try {
      const design = { ...defaultStudioTheme(0), id: 'installed-screens', name: 'Screens', presentation: parsePresentation({ layout: { screens: [screen('picks', { icon: 'flame' }), screen('more')] } }) }
      studioThemes.set([design])
      activeStudioThemeId.set('installed-screens')
      themePreset.set('custom')
      expect(get(themeScreens).map((entry) => entry.id)).toEqual(['picks', 'more'])
      themeLayoutEnabled.set({ 'installed-screens': false })
      expect(get(themeScreens)).toEqual([])
      themeLayoutEnabled.set({})
      themePreset.set('izumi')
      expect(get(themeScreens)).toEqual([])
    } finally {
      studioThemes.set(before.themes)
      activeStudioThemeId.set(before.id)
      themePreset.set(before.preset)
      themeLayoutEnabled.set(before.enabled)
    }
  })
  it('renders a screen with Home itself and lists screens after the destinations', () => {
    const route = read('../../routes/app/screen/[id]/+page.svelte')
    expect(route).toContain('provideThemeScreen(screen)')
    expect(route).toContain('<Home />')
    for (const host of ['../../routes/app/home/+page.svelte', '../components/catalog/CatalogHome.svelte', '../components/catalog/MergedCatalogHome.svelte']) {
      expect(read(host), host).toContain('homeLayoutFor(')
    }
    expect(read('../components/shell/theme-screen-icons.ts')).toContain("return { id: 'screen', screen: screen.id, href: `/app/screen/${screen.id}`")
    const sidebar = read('../components/shell/Sidebar.svelte')
    expect(sidebar).toContain('const screenItems = $derived($themeScreens.map(screenDestination))')
    expect(sidebar).toContain('...screenItems])')
    expect(sidebar).toContain("href.startsWith('/app/screen/') ? page.url.pathname === href")
  })
})
