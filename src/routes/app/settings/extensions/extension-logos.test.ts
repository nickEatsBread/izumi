import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { iconSrc, logoTile } from '$lib/stremio/addon-logo'

// Source icons in the extensions list. Two facts have to hold together for a logo to appear:
// the page has to render AddonLogo (which owns the icon → tile fallback ladder), and the icon the
// native side hands us has to be in the bare-base64 form AddonLogo understands. This app cannot
// boot in a plain browser — it reads Tauri metadata at init — so these are asserted here rather
// than through the preview.

const page = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8')

describe('extension list logos', () => {
  it('renders every store row and plugin row through AddonLogo', () => {
    expect(page).toContain("import AddonLogo from '$lib/components/player/AddonLogo.svelte'")
    // The catalog ("store") row keys its icon on the package id, which for an Aniyomi package IS
    // the Android package name the installed-icon map is keyed by.
    expect(page).toContain('<AddonLogo logo={jvmIcons.get(p.id)} name={p.name} id={p.id} size={24} />')
    // A plugin prefers its own manifest icon and falls back to the installed launcher icon.
    expect(page).toContain('<AddonLogo logo={p.icon ?? jvmIcons.get(p.id)} name={p.name} id={p.id} size={24} />')
  })

  it('never leaves a raw <img> to render a broken box for a missing icon', () => {
    expect(page).not.toMatch(/<img[^>]*iconSrc\(/)
  })

  it('loads the installed icons without blocking the package list', () => {
    // The enumeration can spin the JVM runtime; the list must paint first.
    expect(page).toContain('void jvmExtensionIcons().then(')
  })

  it('accepts the bare base64 the native side inlines for an Aniyomi icon', () => {
    // inline_source_icons replaces the bridge's filesystem path with raw base64 (no data: prefix),
    // which is the same convention extension icons already use.
    expect(iconSrc('iVBORw0KGgoAAAANSUhEUg==')).toBe('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==')
    // A future bridge returning a real URL must pass through untouched.
    expect(iconSrc('https://example.test/icon.png')).toBe('https://example.test/icon.png')
    expect(iconSrc(undefined)).toBeUndefined()
  })

  it('gives sources without any icon a stable, distinguishable tile', () => {
    const a = logoTile('eu.kanade.tachiyomi.animeextension.en.onetwothreeanime', '123Anime')
    const b = logoTile('eu.kanade.tachiyomi.animeextension.en.gogoanime', 'GogoAnime')
    expect(a.initial).toBe('1')
    expect(b.initial).toBe('G')
    // Same source, same colour on every render — that is what makes the list scannable.
    expect(logoTile('eu.kanade.tachiyomi.animeextension.en.gogoanime', 'GogoAnime')).toEqual(b)
    expect(a.from).not.toBe(b.from)
  })
})
