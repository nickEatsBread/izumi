import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const card = read('./SmallCard.svelte')
const preview = read('./PreviewCard.svelte')

describe('expanding hover preview (API 6 cardPreview: "expand")', () => {
  it('SmallCard opens it after a 500 ms dwell that every close path cancels', () => {
    expect(card).toContain("import { expandPos, type ExpandBox } from './expand-pos'")
    expect(card).toContain("const expandMode = $derived($themePresentation?.cardPreview === 'expand')")
    expect(card).toMatch(/expandBox = expandPos\(/)
    expect(card).toMatch(/openT = setTimeout\([\s\S]*?hovered = true \}, 500\)/)
    expect(card).toMatch(/function scheduleClose\(\) \{ clearTimeout\(openT\)/)
    expect(card).toMatch(/const close = \(\) => \{ clearTimeout\(openT\); hovered = false \}/)
    expect(card).toMatch(/\$effect\(\(\) => \(\) => \{[^}]*clearTimeout\(openT\)/)
  })

  it('SmallCard renders the expand popup and the classic popup as sibling blocks', () => {
    const expand = card.indexOf('{#if hovered && !previewOff && expandMode && expandBox}')
    const classic = card.indexOf('{#if hovered && !previewOff && !expandMode}')
    expect(expand).toBeGreaterThan(-1)
    expect(classic).toBeGreaterThan(expand)
    // Svelte 5 transitions are local: nesting one block in the other would skip its transition.
    expect(card.slice(expand, classic)).toMatch(/\{\/if\}\s*$/)
    expect(card).toContain('transform-origin:${expandBox.originX}px ${expandBox.originY}px')
    expect(card).toMatch(/function grow\([\s\S]*?scale\(\$\{2 \/ 3 \+ t \/ 3\}\)/)
    expect(card).toContain('in:grow={{ duration: reducedMotion() ? 0 : 300 }} out:grow={{ duration: reducedMotion() ? 0 : 220 }}')
    expect(card).toContain('<PreviewCard {media} {preferLinkedRating} variant="expand" artHeight={expandBox.artHeight} logo={cardArt.art.logo} />')
    expect(card).toContain('<PreviewCard {media} {preferLinkedRating} />')
  })

  it('PreviewCard has an expand variant with preview hooks and keeps the classic popup', () => {
    expect(preview).toContain("variant = 'popup'")
    expect(preview).toContain('data-part="preview" data-variant="expand"')
    for (const part of ['preview.art', 'preview.logo', 'preview.title', 'preview.actions', 'preview.meta', 'preview.genres']) {
      expect(preview, part).toContain(`data-part="${part}"`)
    }
    for (const action of ['play', 'list', 'favorite', 'details']) {
      expect(preview, action).toContain(`data-part="preview.action" data-action="${action}"`)
    }
    expect(preview).toContain('<div data-part="card" data-family="preview" class="preview-in w-[17.5rem]')
  })
})
