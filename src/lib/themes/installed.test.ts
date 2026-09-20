// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { studioThemes, defaultStudioTheme, activeStudioThemeId, themeStudioPreview } from '$lib/settings/theme-studio'
import { themePreset } from '$lib/settings/ui'
import { installedThemes, installTheme, applyInstalledTheme, removeInstalledTheme, rollbackTheme, rebaseDesign, previewTheme, cancelThemePreview, normalizeInstalledThemes } from './installed'
import { parseSharedTheme, parseThemePackage } from './packages'

const sample = { app: 'izumi', kind: 'theme-package', schemaVersion: 1, themeApi: 1, id: 'test.cinema', name: 'Cinema', author: 'Test', description: 'Cinema presentation.', version: '1.0.0', design: { radius: 1, presentation: { rows: { defaults: { width: 160, gap: 12 } } } } }
const prepared = (patch = {}) => ({ package: parseThemePackage({ ...sample, ...patch }), origin: 'https://example.test/release.json', updateUrl: 'https://example.test/release.json' })
beforeEach(() => { installedThemes.set([]); studioThemes.set([defaultStudioTheme(0)]); themePreset.set('izumi'); cancelThemePreview() })
afterEach(() => vi.restoreAllMocks())
describe('theme installation and personal edits', () => {
  it('previews without persisting or changing the active theme and cancels cleanly', () => {
    const before = get(studioThemes)
    previewTheme(prepared())
    expect(get(themeStudioPreview)?.radius).toBe(1)
    expect(get(studioThemes)).toEqual(before)
    expect(get(themePreset)).toBe('izumi')
    cancelThemePreview(); expect(get(themeStudioPreview)).toBeNull()
  })
  it('keeps personal edits through an update and can restore the prior version', () => {
    const installed = installTheme(prepared()); applyInstalledTheme(installed)
    studioThemes.update(themes => themes.map(theme => theme.id === installed.designId ? { ...theme, radius: 1.5, presentation: { ...theme.presentation, rows: { defaults: { width: 220, gap: 12 } } } } : theme))
    installTheme(prepared({ version: '1.1.0', design: { radius: .8, presentation: { rows: { defaults: { width: 170, gap: 20 } } } } }))
    const edited = get(studioThemes).find(theme => theme.id === installed.designId)!
    expect(edited.radius).toBe(1.5)
    expect(edited.presentation?.rows?.defaults).toEqual({ width: 220, gap: 20 })
    expect(get(activeStudioThemeId)).toBe(installed.designId)
    rollbackTheme(installed.id)
    expect(get(installedThemes)[0].package.version).toBe('1.0.0')
    expect(get(studioThemes).find(theme => theme.id === installed.designId)?.presentation?.rows?.defaults).toEqual({ width: 220, gap: 12 })
  })
  it('prevents same-ID origin takeover and downgrade', () => {
    installTheme(prepared())
    expect(() => installTheme({ ...prepared({ version: '1.1.0' }), origin: 'https://other.test/theme' })).toThrow('another location')
    expect(() => installTheme(prepared())).toThrow('already installed')
    expect(get(installedThemes)).toHaveLength(1)
  })
  it('previews the updated design with personal edits already rebased', () => {
    const item = installTheme(prepared())
    studioThemes.update(themes => themes.map(theme => theme.id === item.designId ? { ...theme, radius: 1.6 } : theme))
    const next = prepared({ version: '1.1.0', design: { radius: .8, fontScale: 1.1 } })
    previewTheme(next)
    expect(get(themeStudioPreview)).toMatchObject({ radius: 1.6, fontScale: 1.1 })
    expect(get(installedThemes)[0].package.version).toBe('1.0.0')
    const preview = get(themeStudioPreview)!
    installTheme(next)
    expect(get(studioThemes).find(theme => theme.id === item.designId)).toMatchObject({ radius: preview.radius, fontScale: preview.fontScale })
  })
  it.each(['theme-studio-themes-v1', 'installed-themes-v1'])('restores the saved library if writing %s fails', (key) => {
    const before = get(studioThemes)
    const original = Storage.prototype.setItem
    let failed = false
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, name: string, value: string) {
      if (name === key && !failed) { failed = true; throw new Error('storage full') }
      original.call(this, name, value)
    })
    expect(() => installTheme(prepared())).toThrow('device storage')
    expect(get(studioThemes)).toEqual(before)
    expect(get(installedThemes)).toEqual([])
    expect(JSON.parse(localStorage.getItem('theme-studio-themes-v1')!)).toEqual(before)
    expect(JSON.parse(localStorage.getItem('installed-themes-v1')!)).toEqual([])
  })
  it('keeps valid saved installations while ignoring corrupt records', () => {
    const item = installTheme(prepared())
    expect(normalizeInstalledThemes([null, {}, item, { ...item, origin: 'javascript:invalid' }])).toEqual([item])
    expect(normalizeInstalledThemes('broken')).toEqual([])
  })
  it.each(['file', 'link'])('retains personal %s imports after saving and loading the library', (kind) => {
    const pkg = parseSharedTheme({ app: 'izumi', kind: 'theme', version: 1, theme: defaultStudioTheme(0) })
    const item = installTheme({ package: pkg, origin: kind === 'file' ? `file:${pkg.id}` : 'https://example.test/shared.json' })
    const saved = JSON.parse(localStorage.getItem('installed-themes-v1')!)
    expect(normalizeInstalledThemes(saved)).toEqual([item])
    // A reserved ID must not bypass the rest of the persisted-package validation.
    saved[0].package.design.tokens.background = 'invalid'
    expect(normalizeInstalledThemes(saved)).toEqual([])
  })
  it('retains valid shared rollback records while rejecting mismatched identities', () => {
    const pkg = parseSharedTheme({ app: 'izumi', kind: 'theme', version: 1, theme: defaultStudioTheme(0) })
    const item = installTheme({ package: pkg, origin: `file:${pkg.id}` })
    const previous = { package: pkg, design: get(studioThemes).find(theme => theme.id === item.designId)! }
    const saved = JSON.parse(JSON.stringify([{ ...item, previous }]))
    expect(normalizeInstalledThemes(saved)).toEqual([{ ...item, previous }])
    saved[0].previous.package.id = 'shared.different'
    expect(normalizeInstalledThemes(saved)).toEqual([])
  })
  it('can reinstall the same version after its editable design was deleted', () => {
    const item = installTheme(prepared())
    studioThemes.update(themes => themes.filter(theme => theme.id !== item.designId))
    const restored = installTheme(prepared())
    expect(restored.designId).toBe(item.designId)
    expect(() => applyInstalledTheme(restored)).not.toThrow()
    expect(get(installedThemes)).toHaveLength(1)
  })
  it('removes an active install and returns to the default without removing other themes', () => {
    const installed = installTheme(prepared()); applyInstalledTheme(installed); removeInstalledTheme(installed.id)
    expect(get(themePreset)).toBe('izumi'); expect(get(installedThemes)).toHaveLength(0)
    expect(get(studioThemes)).toHaveLength(1)
  })
  it('keeps a shipped preset when removing an installation that is not the active appearance', () => {
    const installed = installTheme(prepared()); applyInstalledTheme(installed)
    themePreset.set('midnight')
    removeInstalledTheme(installed.id)
    expect(get(themePreset)).toBe('midnight')
  })
  it('ends a stale installation preview when an install is applied or rolled back', () => {
    const item = installTheme(prepared())
    previewTheme(prepared({ version: '1.1.0', design: { radius: .7 } }))
    expect(get(themeStudioPreview)).not.toBeNull()
    applyInstalledTheme(item)
    expect(get(themeStudioPreview)).toBeNull()
    installTheme(prepared({ version: '1.1.0' }))
    previewTheme(prepared({ version: '1.2.0', design: { radius: .4 } }))
    expect(get(themeStudioPreview)).not.toBeNull()
    rollbackTheme(item.id)
    expect(get(themeStudioPreview)).toBeNull()
  })
  it('preserves explicit deletion and treats templates as structural personal edits', () => {
    expect(rebaseDesign({ a: 1, b: 2 }, { a: 3 }, { a: 10, b: 20, c: 4 })).toEqual({ a: 3, c: 4 })
    expect(rebaseDesign({ children: [1, 2] }, { children: [2, 1] }, { children: [1, 2, 3] })).toEqual({ children: [2, 1] })
  })
})
