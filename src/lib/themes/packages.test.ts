import { describe, expect, it } from 'vitest'
import { parseCatalog, parseThemePackage, parseSharedTheme, parseRelease, themeUrl, newerVersion, portablePackage } from './packages'
import { defaultStudioTheme } from '$lib/settings/theme-studio'

export const samplePackage = { app: 'izumi', kind: 'theme-package', schemaVersion: 1, themeApi: 1, id: 'test.cinema', name: 'Cinema', author: 'Test', description: 'An optional rank design.', version: '1.0.0', design: { radius: 1, backdrop: 'solid', presentation: { hero: { rank: { type: 'text', field: 'rank' } } } } }
describe('installable theme packages', () => {
  it('normalizes appearance while retaining a validated component template', () => {
    const parsed = parseThemePackage(samplePackage)
    expect(parsed.design.presentation?.hero?.rank?.field).toBe('rank')
    expect(parsed.design.tokens.background).toBeTruthy()
    expect((portablePackage(parsed).design as object)).not.toHaveProperty('id')
  })
  it('rejects unsupported API versions, styles, settings and colors', () => {
    expect(() => parseThemePackage({ ...samplePackage, themeApi: 9 })).toThrow('theme API')
    expect(() => parseThemePackage({ ...samplePackage, design: { radius: 200 } })).toThrow('appearance')
    expect(() => parseThemePackage({ ...samplePackage, design: { accountToken: 'hidden' } })).toThrow('unsupported')
    expect(() => parseThemePackage({ ...samplePackage, design: { tokens: { theme: 'url(https://example.test)' } } })).toThrow('color')
  })
  it('reserves the shared namespace for client-minted export identities', () => {
    expect(() => parseThemePackage({ ...samplePackage, id: 'shared.cinema' })).toThrow('identity')
    expect(parseThemePackage({ ...samplePackage, id: 'test.shared' }).id).toBe('test.shared')
    expect(() => parseSharedTheme({ ...samplePackage, id: 'shared.cinema' })).toThrow('identity')
    const entry = { ...samplePackage, id: 'shared.cinema', download: 'https://example.test/theme.json', sha256: 'a'.repeat(64), bytes: 500, tags: [] }
    expect(() => parseRelease(entry)).toThrow('identity')
    expect(() => parseCatalog({ app: 'izumi', kind: 'theme-catalog', schemaVersion: 1, themes: [entry] })).toThrow('identity')
  })
  it('requires exact listing integrity metadata and unique catalog identities', () => {
    const entry = { ...samplePackage, download: 'https://example.test/theme.json', sha256: 'a'.repeat(64), bytes: 500, tags: ['Dark'] }
    expect(parseRelease(entry).bytes).toBe(500)
    expect(() => parseRelease({ ...entry, sha256: 'none' })).toThrow('checksum')
    expect(() => parseCatalog({ app: 'izumi', kind: 'theme-catalog', schemaVersion: 1, themes: [entry, entry] })).toThrow('duplicate')
  })
  it('accepts existing personal exports and validates their optional layouts', () => {
    const theme = { ...defaultStudioTheme(0), presentation: { hero: { hidden: true } } }
    const exported = { app: 'izumi', kind: 'theme', version: 1, theme }
    expect(parseSharedTheme(exported)).toMatchObject({ id: 'shared.izumi-studio', design: { presentation: theme.presentation } })
    expect(() => parseSharedTheme({ ...exported, theme: { ...theme, presentation: { execute: 'script' } } })).toThrow('unsupported')
  })
  it('accepts direct links and normalizes GitHub file links without credentials', () => {
    expect(themeUrl('https://github.com/author/themes/blob/main/cinema.json?raw=true')).toBe('https://raw.githubusercontent.com/author/themes/main/cinema.json')
    expect(() => themeUrl('http://example.test/theme')).toThrow('HTTPS')
    expect(() => themeUrl('https://user:secret@example.test/theme')).toThrow('HTTPS')
    expect(newerVersion('1.10.0', '1.9.0')).toBe(true)
    expect(newerVersion('1.0.0', '1.0.0')).toBe(false)
  })
})
