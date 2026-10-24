import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const carousel = read('./Carousel.svelte')

describe('API 6 row focus and caption template', () => {
  it('marks an anchored carousel row for the controller reveal path, never a grid', () => {
    expect(carousel).toContain(`data-row-focus={!grid && appearance.focus === 'anchor' ? 'anchor' : undefined}`)
  })

  it('cards register their media, a Continue card its own model too, and drop it on teardown', () => {
    const registry = read('./card-registry.ts')
    expect(registry).toContain('export interface CardEntry { media: Media; model?: DisplayModel }')
    expect(registry).toContain('export const cardMedia = new WeakMap<Element, CardEntry>()')
    const entries = { './SmallCard.svelte': '{ media }', './ContinueCard.svelte': '{ media, model: continueModel }' }
    for (const [file, entry] of Object.entries(entries)) {
      const card = read(file)
      expect(card, file).toContain("import { cardMedia } from './card-registry'")
      const effect = card.split('\n').find((line) => line.includes('cardMedia.set('))
      expect(effect, file).toMatch(/^\s*\$effect\(\(\) => \{/)
      expect(effect, file).toContain(`cardMedia.set(node, ${entry}); return () => cardMedia.delete(node) })`)
    }
  })

  it('loads the synopsis in Game mode for a row whose theme templates its caption', () => {
    for (const file of ['./HomeRow.svelte', './ListRow.svelte', './PersonalizedRow.svelte']) {
      const row = read(file)
      expect(row, file).toContain('const captionData = $derived(!!rowScope && !!resolveRow($themePresentation, rowScope().id).captionTemplate)')
      expect(row, file).toContain('withPreview: !$gameMode || captionData')
      expect(row, file).not.toMatch(/withPreview: !\$gameMode(?! \|\| captionData)/)
    }
  })

  it('binds the focused card’s registered model, else its media’s, to the template', () => {
    expect(carousel).toContain("import { cardMedia, type CardEntry } from './card-registry'")
    expect(carousel).toContain("const card = target.closest('[data-part=\"card\"]')")
    expect(carousel).toContain('entry: card ? cardMedia.get(card) : undefined')
    expect(carousel).toContain('const captionModel = $derived(caption.entry ? caption.entry.model ?? mediaDisplayModel(caption.entry.media) : {})')
  })

  it('draws the template inside row.caption and keeps the title and meta line as the fallback', () => {
    const start = carousel.indexOf('data-part="row.caption"')
    const block = carousel.slice(start, carousel.indexOf('</div>\n  {/if}\n</section>', start))
    expect(block).toContain('{#if appearance.captionTemplate && (caption.entry || !caption.title)}')
    // Keyed on the caption, which every focus move replaces, so a theme's animation replays per card.
    expect(block).toContain('{#key caption}<ThemeNode node={appearance.captionTemplate} model={captionModel} />{/key}')
    expect(block).toContain('{:else}')
    expect(block).toContain('<span data-part="row.caption.title"')
    expect(block).toContain('<span data-part="row.caption.meta"')
    // A template may wrap (a two-line synopsis): the line keeps its height but may grow.
    expect(block).toContain('min-h-7')
    expect(block).not.toMatch(/[\s"]h-7\b/)
  })
})
