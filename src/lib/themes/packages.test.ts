import { describe, expect, it } from 'vitest'
import { parseCatalog, parseThemePackage, parseSharedTheme, parseRelease, platformFor, shotsFor, themeUrl, newerVersion, portablePackage } from './packages'
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
  it('accepts additive series-page and chrome slots on API 1 packages', () => {
    const parsed = parseThemePackage({
      ...samplePackage,
      design: {
        ...samplePackage.design,
        presentation: {
          density: 'compact',
          trueBlack: true,
          detail: { layout: 'split', episodes: { placement: 'right', card: { type: 'text', field: 'episodeTitle' } } },
          shell: { nav: 'top', compact: true },
          player: { seekbarHeight: 8, seekbarColor: '#c8c8e0' },
          cards: { continue: { type: 'artwork', artwork: 'still' } },
        },
      },
    })
    expect(parsed.design.presentation?.detail?.layout).toBe('split')
    expect(parsed.design.presentation?.cards?.continue?.artwork).toBe('still')
    expect(parsed.themeApi).toBe(1)
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
  it('accepts theme API 5 packages and advertises API 5 as the newest', async () => {
    const { THEME_API, SUPPORTED_THEME_APIS, MAX_THEME_BYTES } = await import('./packages')
    expect(THEME_API).toBe(5)
    expect(SUPPORTED_THEME_APIS).toEqual([1, 2, 3, 4, 5])
    expect(MAX_THEME_BYTES).toBe(512_000)
    expect(parseThemePackage({ ...samplePackage, themeApi: 4 }).themeApi).toBe(4)
    expect(parseThemePackage({ ...samplePackage, themeApi: 5 }).themeApi).toBe(5)
    expect(() => parseThemePackage({ ...samplePackage, themeApi: 6 })).toThrow('theme API')
  })
  it('validates API 4 keys against the API a package declares', () => {
    const presentation = { mobile: { rootSize: 16 }, detail: { buttons: ['play', 'download'] } }
    const pkg = { ...samplePackage, themeApi: 4, design: { ...samplePackage.design, presentation } }
    expect(parseThemePackage(pkg).design.presentation).toMatchObject(presentation)
    expect(() => parseThemePackage({ ...pkg, themeApi: 3 })).toThrow('unsupported')
  })
  // An installed package is stored as parsed (at the newest API) and re-read against the API it
  // declares on every start, so parsing must never add a newer key to an older package.
  it('re-reads a stored API 3 package under API 3', () => {
    const presentation = {
      layout: { home: [{ block: 'tabbed-grid', tabs: [{ label: 'Trending', role: 'trending' }, { label: 'Popular', role: 'popular' }] }, { role: 'hero' }] },
      shell: { bottomNav: { hide: 'scroll' } },
      detail: { countdown: 'long', sections: { tabs: ['overview', 'episodes'] } },
    }
    const stored = parseThemePackage({ ...samplePackage, themeApi: 3, design: { ...samplePackage.design, presentation } })
    expect(parseThemePackage(portablePackage(stored)).design.presentation).toEqual(stored.design.presentation)
  })
  it('accepts API 3 stylesheets and fonts and keeps them off older APIs', () => {
    const pkg = { ...samplePackage, themeApi: 3, design: { ...samplePackage.design, css: '[data-part="card"]{border-radius:4px}', fonts: { ui: 'poppins' } } }
    const parsed = parseThemePackage(pkg)
    expect(parsed.design.css).toBe('[data-part="card"]{border-radius:4px}')
    expect(parsed.design.fonts).toEqual({ ui: 'poppins' })
    expect(() => parseThemePackage({ ...pkg, themeApi: 2 })).toThrow('unsupported design')
    expect(() => parseThemePackage({ ...pkg, design: { css: '.a{background:url(https://e.test/a.png)}' } })).toThrow('URLs')
    expect(() => parseThemePackage({ ...pkg, design: { fonts: { ui: 'comic-sans' } } })).toThrow('font')
  })
})

describe('listing screenshots', () => {
  const entry = { ...samplePackage, download: 'https://example.test/theme.json', sha256: 'a'.repeat(64), bytes: 500, tags: [] }
  const shot = (screen: string, platform = 'desktop') => ({ screen, platform, url: `https://example.test/${platform}-${screen}.jpg` })
  it('keeps valid per-screen screenshots', () => {
    expect(parseRelease({ ...entry, screenshots: [shot('home'), shot('series', 'phone')] }).screenshots).toEqual([shot('home'), shot('series', 'phone')])
  })
  it('rejects unknown screens and platforms, plain HTTP, duplicates and long lists', () => {
    expect(() => parseRelease({ ...entry, screenshots: [shot('player')] })).toThrow('screenshots')
    expect(() => parseRelease({ ...entry, screenshots: [shot('home', 'tv')] })).toThrow('screenshots')
    expect(() => parseRelease({ ...entry, screenshots: [{ ...shot('home'), url: 'http://example.test/a.jpg' }] })).toThrow('HTTPS')
    expect(() => parseRelease({ ...entry, screenshots: [shot('home'), shot('home')] })).toThrow('screenshots')
    expect(() => parseRelease({ ...entry, screenshots: Array.from({ length: 13 }, (_, i) => shot('home', String(i))) })).toThrow('screenshots')
  })
  it('orders one platform by screen and falls back to the single preview', () => {
    const release = parseRelease({ ...entry, preview: 'https://example.test/p.png', screenshots: [shot('search'), shot('home'), shot('home', 'phone')] })
    expect(shotsFor(release, 'desktop').map((item) => item.screen)).toEqual(['home', 'search'])
    expect(shotsFor(parseRelease({ ...entry, preview: 'https://example.test/p.png' }), 'phone')).toEqual([{ screen: 'home', platform: 'phone', url: 'https://example.test/p.png' }])
    expect(shotsFor(parseRelease(entry), 'desktop')).toEqual([])
  })
})

describe('screenshot platform for a device', () => {
  const entry = { ...samplePackage, download: 'https://example.test/theme.json', sha256: 'a'.repeat(64), bytes: 500, tags: [] }
  const shot = (screen: string, platform: string) => ({ screen, platform, url: `https://example.test/${platform}-${screen}.jpg` })
  it("shows the device's own screenshots, even for a phone-first theme on desktop", () => {
    const both = parseRelease({ ...entry, platforms: ['phone', 'desktop'], screenshots: [shot('home', 'phone'), shot('home', 'desktop')] })
    expect(platformFor(both, 'desktop')).toBe('desktop')
    expect(platformFor(both, 'phone')).toBe('phone')
  })
  it('falls back to the other platform only when the device has none', () => {
    expect(platformFor(parseRelease({ ...entry, screenshots: [shot('home', 'phone')] }), 'desktop')).toBe('phone')
    expect(platformFor(parseRelease(entry), 'desktop')).toBe('desktop')
  })
})
