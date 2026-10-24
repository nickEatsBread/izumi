import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const carousel = read('./Carousel.svelte')

describe('API 6 row focus and caption template', () => {
  it('marks an anchored carousel row for the controller reveal path, never a grid', () => {
    expect(carousel).toContain(`data-row-focus={!grid && appearance.focus === 'anchor' ? 'anchor' : undefined}`)
  })

  it('cards register their media and drop it on teardown', () => {
    expect(read('./card-registry.ts')).toContain('export const cardMedia = new WeakMap<Element, Media>()')
    for (const file of ['./SmallCard.svelte', './ContinueCard.svelte']) {
      const card = read(file)
      expect(card, file).toContain("import { cardMedia } from './card-registry'")
      expect(card, file).toMatch(/\$effect\(\(\) => \{[^\n]*cardMedia\.set\(node, media\); return \(\) => cardMedia\.delete\(node\) \}\)/)
    }
  })

  it('binds the focused card’s registered media to the template', () => {
    expect(carousel).toContain("import { cardMedia } from './card-registry'")
    expect(carousel).toContain("const card = target.closest('[data-part=\"card\"]')")
    expect(carousel).toContain('media: card ? cardMedia.get(card) : undefined')
    expect(carousel).toContain('const captionModel = $derived(caption.media ? mediaDisplayModel(caption.media) : {})')
  })

  it('draws the template inside row.caption and keeps the title and meta line as the fallback', () => {
    const start = carousel.indexOf('data-part="row.caption"')
    const block = carousel.slice(start, carousel.indexOf('</div>\n  {/if}\n</section>', start))
    expect(block).toContain('{#if appearance.captionTemplate && (caption.media || !caption.title)}')
    expect(block).toContain('<ThemeNode node={appearance.captionTemplate} model={captionModel} />')
    expect(block).toContain('{:else}')
    expect(block).toContain('<span data-part="row.caption.title"')
    expect(block).toContain('<span data-part="row.caption.meta"')
    // A template may wrap (a two-line synopsis): the line keeps its height but may grow.
    expect(block).toContain('min-h-7')
    expect(block).not.toMatch(/[\s"]h-7\b/)
  })
})
