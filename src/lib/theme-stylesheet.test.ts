// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

describe('theme stylesheet form', () => {
  let stop: () => void = () => {}
  let safeMode: typeof import('$lib/themes/safe-mode')
  const scopeRule = Object.getOwnPropertyDescriptor(globalThis, 'CSSScopeRule')
  const setScope = (supported: boolean) => {
    if (supported) Object.defineProperty(globalThis, 'CSSScopeRule', { value: class {}, configurable: true, writable: true })
    else delete (globalThis as { CSSScopeRule?: unknown }).CSSScopeRule
  }
  const sheet = () => document.getElementById('izumi-theme-css')?.textContent ?? null

  beforeAll(async () => {
    window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
    const theme = await import('./theme')
    const studio = await import('$lib/settings/theme-studio')
    safeMode = await import('$lib/themes/safe-mode')
    stop = theme.startThemeSync()
    studio.themeStudioPreview.set({ ...studio.defaultStudioTheme(1), css: ':scope { --a: 1px } .card { color: red }' })
  })
  afterEach(() => {
    if (scopeRule) Object.defineProperty(globalThis, 'CSSScopeRule', scopeRule)
    else setScope(false)
  })
  afterAll(() => stop())

  it('applies plain rules while no protected surface is mounted', () => {
    setScope(true)
    expect(sheet()).not.toContain('@scope')
    expect(sheet()).toContain(':root { --a: 1px; }')
    expect(sheet()).toContain('.card { color: red; }')
  })
  it('wraps the rules in @scope from the moment a surface mounts until it is destroyed', () => {
    setScope(true)
    const surface = safeMode.protectedSurface(document.createElement('div'))
    expect(sheet()).toMatch(/^@scope \(:root\) to \(\[data-theme-protected\], \[data-theme-unthemed\]\) \{\n:scope \{ --a: 1px; \}/)
    surface.destroy()
    expect(sheet()).not.toContain('@scope')
  })
  it('touches only the stylesheet as a surface opens and closes, never <html>', () => {
    // Game mode's OSD colours re-read on <html> mutations and open a surface to read them.
    setScope(true)
    const observer = new MutationObserver(() => {})
    observer.observe(document.documentElement, { attributes: true })
    safeMode.protectedSurface(document.createElement('div')).destroy()
    expect(observer.takeRecords()).toEqual([])
    observer.disconnect()
  })
  it('removes the stylesheet while a surface is mounted on engines without @scope', () => {
    setScope(false)
    const surface = safeMode.protectedSurface(document.createElement('div'))
    expect(sheet()).toBeNull()
    surface.destroy()
    expect(sheet()).toContain('.card { color: red; }')
  })
})
