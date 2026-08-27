import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { iconSrc } from '$lib/stremio/addon-logo'

// Source icons in the extensions list and the store. Two facts have to hold together for a logo to
// appear: the page has to render AddonLogo (which owns the icon → placeholder fallback ladder), and
// the icon the native side hands us has to be in the bare-base64 form AddonLogo understands. This
// app cannot boot in a plain browser — it reads Tauri metadata at init — so these are asserted here
// rather than through the preview.

const page = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8')
const store = readFileSync(fileURLToPath(new URL('../store/+page.svelte', import.meta.url)), 'utf8')

describe('extension list logos', () => {
  it('renders every store row and plugin row through AddonLogo', () => {
    expect(page).toContain("import AddonLogo from '$lib/components/player/AddonLogo.svelte'")
    // The catalog ("store") row keys its icon on the package id, which for an Aniyomi package IS
    // the Android package name the installed-icon map is keyed by. The rendered size is a layout
    // choice that mobile tuning moves around, so it is deliberately not asserted.
    expect(page).toContain('<AddonLogo logo={jvmIcons.get(p.id)} name={p.name} id={p.id} size=')
    // A plugin prefers its own manifest icon and falls back to the installed launcher icon.
    expect(page).toContain('<AddonLogo logo={p.icon ?? jvmIcons.get(p.id)} name={p.name} id={p.id} size=')
  })

  it('never leaves a raw <img> to render a broken box for a missing icon', () => {
    expect(page).not.toMatch(/<img[^>]*iconSrc\(/)
  })

  it('loads the installed icons without blocking the package list', () => {
    // The enumeration can spin the JVM runtime; the list must paint first.
    expect(page).toContain('void installedPackageIcons(localPackages).then(')
  })

  it('renders orphan installed packages even when no catalog URL is on the list', () => {
    expect(page).not.toContain('Installed sources')
    expect(page).toContain('orphans')
    expect(page).toContain('<AddonLogo logo={jvmIcons.get(p.id)} name={p.name} id={p.id} size={40} />')
  })

  it('accepts the bare base64 the native side inlines for an Aniyomi icon', () => {
    // inline_source_icons replaces the bridge's filesystem path with raw base64 (no data: prefix),
    // which is the same convention extension icons already use.
    expect(iconSrc('iVBORw0KGgoAAAANSUhEUg==')).toBe('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==')
    // A future bridge returning a real URL must pass through untouched.
    expect(iconSrc('https://example.test/icon.png')).toBe('https://example.test/icon.png')
    expect(iconSrc(undefined)).toBeUndefined()
  })

  it('draws one shared placeholder, never a locally invented one', () => {
    // A source with several plugins has no icon of its own. It used to get a bespoke grey puzzle
    // tile here while the store drew a themed one and AddonLogo drew a coloured initial — three
    // answers to the same question.
    expect(page).toContain("import SourcePlaceholder from '$lib/components/SourcePlaceholder.svelte'")
    expect(page).toContain('<SourcePlaceholder size={40} />')
    expect(page).not.toContain('@lucide/svelte/icons/puzzle')
    expect(store).not.toContain('@lucide/svelte/icons/puzzle')
  })
})

describe('store icons', () => {
  it('shows a package its real icon instead of a fixed glyph', () => {
    // Both store lists — the catalog tab and the installed section — go through AddonLogo, so a
    // package with artwork shows it and one without gets the same placeholder as everywhere else.
    expect(store).toContain("import AddonLogo from '$lib/components/player/AddonLogo.svelte'")
    expect(store).toContain('<AddonLogo logo={packageIcon(item.id)} name={item.name} id={item.id} size={40} />')
    expect(store).toContain('<AddonLogo logo={packageIcon(item.id)} name={item.name} id={item.id} size={36} />')
  })

  it('resolves those icons off the render path', () => {
    // Same shape as the sources screen: the list paints, then icons fill in. Icon loading can
    // spin the JVM runtime, so awaiting it before the first paint would stall the whole page.
    expect(store).toContain('void installedPackageIcons(installedPackages).then((icons) => { jvmIcons = icons })')
    expect(store).toContain('fetchExtensionMeta(spec)')
  })
})
