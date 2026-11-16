import { get } from 'svelte/store'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT, hasAttr, markupElements, repoRelative, svelteFilesUnder } from '../../test/svelte-markup'
import { isSafeModeChord, protectedSurface, protectedSurfaceCount, themeSafeMode } from './safe-mode'

const chord = (patch: Partial<KeyboardEvent>) => ({ code: 'KeyT', altKey: true, shiftKey: true, ctrlKey: true, metaKey: false, ...patch })

describe('theme safe mode', () => {
  it('recognises Ctrl/Cmd + Alt + Shift + T only', () => {
    expect(isSafeModeChord(chord({}))).toBe(true)
    expect(isSafeModeChord(chord({ ctrlKey: false, metaKey: true }))).toBe(true)
    expect(isSafeModeChord(chord({ altKey: false }))).toBe(false)
    expect(isSafeModeChord(chord({ code: 'KeyR' }))).toBe(false)
  })
  it('counts mounted protected surfaces and ignores double destroys', () => {
    const a = protectedSurface({} as HTMLElement), b = protectedSurface({} as HTMLElement)
    expect(get(protectedSurfaceCount)).toBe(2)
    a.destroy(); b.destroy(); b.destroy()
    expect(get(protectedSurfaceCount)).toBe(0)
  })
  it('counts a Game mode-only surface just while it is active', () => {
    const hud = protectedSurface({} as HTMLElement, false)
    expect(get(protectedSurfaceCount)).toBe(0)
    hud.update(true); hud.update(true)
    expect(get(protectedSurfaceCount)).toBe(1)
    hud.update(false)
    expect(get(protectedSurfaceCount)).toBe(0)
    hud.update(true); hud.destroy(); hud.destroy()
    expect(get(protectedSurfaceCount)).toBe(0)
  })
  it('starts off every session', () => {
    expect(get(themeSafeMode)).toBe(false)
  })
})

describe('protected and unthemed markup', () => {
  // The theme stylesheet only takes its scoped form while a surface is counted, so every marked element
  // counts itself, except the izumi logo pieces: persistent UI, drawn in a shadow root instead.
  const marked = svelteFilesUnder(`${REPO_ROOT}src`).flatMap((file) => markupElements(file))
    .filter((el) => hasAttr(el, 'data-theme-protected') || hasAttr(el, 'data-theme-unthemed'))

  it('registers every element as a protected surface or draws it in a brand shadow root', () => {
    expect(marked.length).toBeGreaterThan(15)
    for (const el of marked) {
      const where = `${repoRelative(el.file)}:${el.line}`
      expect(hasAttr(el, 'use:protectedSurface') !== hasAttr(el, 'use:brandShadow'), where).toBe(true)
    }
  })
  it('keeps the brand shadow to the logo pieces', () => {
    const brand = marked.filter((el) => hasAttr(el, 'use:brandShadow')).map((el) => repoRelative(el.file))
    expect(brand).toEqual(['src/lib/components/BrandText.svelte', 'src/lib/components/Wordmark.svelte', 'src/lib/components/catalog/CatalogBrandLogo.svelte'])
  })
})
