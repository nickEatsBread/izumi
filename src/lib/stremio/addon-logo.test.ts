import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveAddonLogo, iconSrc } from './addon-logo'

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

// There is exactly ONE missing-icon visual in the app, and it is a component rather than something
// generated per source. The colour-hashed initial tile this module used to export was the second
// one; these guard against it (or a replacement for it) creeping back.
const src = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const addonLogo = src('../components/player/AddonLogo.svelte')

describe('the single icon fallback', () => {
  it('no longer generates a per-source tile', () => {
    // A colour seeded off the source id made a placeholder look like real branding next to the
    // real logos it sat beside.
    expect(src('./addon-logo.ts')).not.toContain('logoTile')
  })

  it('routes AddonLogo\'s fallback through the shared placeholder', () => {
    expect(addonLogo).toContain("import SourcePlaceholder from '$lib/components/SourcePlaceholder.svelte'")
    expect(addonLogo).toContain('<SourcePlaceholder {size} />')
  })

  it('keeps the placeholder underneath the icon so a dead host never shows a broken box', () => {
    // The <img> is layered OVER the placeholder and only faded in once it loads; an onerror drops
    // it entirely. Both halves have to be present or a 404 icon leaves the broken-image glyph.
    expect(addonLogo).toContain('onerror={() => (failedSrc = src)}')
    expect(addonLogo).toContain('{#if !broken}')
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
