import { describe, expect, it } from 'vitest'
import { resolveAddonLogo, logoTile, iconSrc } from './addon-logo'

describe('resolveAddonLogo', () => {
  it('passes an absolute url through', () => {
    expect(resolveAddonLogo('https://cdn/icon.png', 'https://addon.test'))
      .toBe('https://cdn/icon.png')
  })

  it('passes a data url through', () => {
    expect(resolveAddonLogo('data:image/png;base64,AAA', 'https://addon.test'))
      .toBe('data:image/png;base64,AAA')
  })

  it('resolves a relative logo against the addon base', () => {
    // Stremio permits a relative manifest logo. We used to treat anything without a scheme as
    // base64 and hand the <img> a garbage data URL, so these addons showed a broken icon forever.
    expect(resolveAddonLogo('/logo.png', 'https://addon.test/config'))
      .toBe('https://addon.test/logo.png')
  })

  it('resolves a bare relative filename against the addon base', () => {
    expect(resolveAddonLogo('logo.png', 'https://addon.test/abc'))
      .toBe('https://addon.test/abc/logo.png')
  })

  it('upgrades a protocol-relative logo to https', () => {
    expect(resolveAddonLogo('//cdn/icon.png', 'https://addon.test')).toBe('https://cdn/icon.png')
  })

  it('returns undefined when there is no logo', () => {
    expect(resolveAddonLogo(undefined, 'https://addon.test')).toBeUndefined()
    expect(resolveAddonLogo('   ', 'https://addon.test')).toBeUndefined()
  })

  it('returns undefined rather than a broken src when the base is unusable', () => {
    expect(resolveAddonLogo('/logo.png', 'not a url')).toBeUndefined()
  })
})

describe('logoTile', () => {
  it('uses the first character of the addon name', () => {
    expect(logoTile('torrentio', 'Torrentio').initial).toBe('T')
  })

  it('falls back to a question mark for a nameless addon', () => {
    expect(logoTile('x', '').initial).toBe('?')
  })

  it('is deterministic for the same seed', () => {
    expect(logoTile('comet', 'Comet').from).toBe(logoTile('comet', 'Comet').from)
  })

  it('gives different addons different colours', () => {
    const seeds = ['torrentio', 'comet', 'mediafusion', 'nyaa', 'torbox']
    expect(new Set(seeds.map((s) => logoTile(s, s).from)).size).toBeGreaterThan(1)
  })

  it('ignores case and punctuation in the seed so one addon keeps one colour', () => {
    expect(logoTile('Torrentio-RD', 'Torrentio').from).toBe(logoTile('torrentio rd', 'Torrentio').from)
  })
})

describe('iconSrc', () => {
  it('wraps a bare base64 extension icon so an image source can load it', () => {
    // Extension icons are stored WITHOUT a data: prefix (parse.ts). Passing one straight to an
    // <image> href renders the broken-image glyph, which is exactly what the loader showed.
    expect(iconSrc('iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=')
  })

  it('leaves an addon manifest URL alone', () => {
    expect(iconSrc('https://cdn/icon.png')).toBe('https://cdn/icon.png')
  })

  it('leaves an already-prefixed data url alone', () => {
    expect(iconSrc('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA')
  })

  it('has nothing to offer for an absent icon', () => {
    expect(iconSrc(undefined)).toBeUndefined()
    expect(iconSrc('  ')).toBeUndefined()
  })
})
