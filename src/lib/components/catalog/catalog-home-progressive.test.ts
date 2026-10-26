import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const home = readFileSync(fileURLToPath(new URL('./CatalogHome.svelte', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

// Coming back to a cached Home built every row and card in one pass (hundreds of cards held the
// Deck's page for over a second). The first screenful renders at once; the rest follow a row a frame.
describe('catalog Home builds only the rows near the screen', () => {
  it('shows the first rows at once', () => {
    expect(home).toContain('const FIRST_ROWS = 4')
    expect(home).toContain('const rowShown = (id: string) => $homeEditorOpen || homeRowIds.indexOf(id) < FIRST_ROWS || revealed.has(id)')
  })

  it('holds a row further down as a skeleton until it comes near the screen, then adds it a row a frame', () => {
    expect(home).toContain('{#if row && !rowShown(id)}\n          <div data-part="row.pending"')
    expect(home).toContain('use:nearViewport={{ onEnter: () => reveal(id), marginViewports: 1.5 }}')
    expect(home).toContain('if (revealQueue.length) revealFrame = requestAnimationFrame(revealNext)')
  })

  it('builds a row\'s first cards, the rest once focus nears them or a pointer comes over it', () => {
    // 334 cards over twenty rows held the Deck's page for 1.5 s every time Home opened.
    const row = readFileSync(fileURLToPath(new URL('./CatalogSectionRow.svelte', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
    expect(row).toContain('const cards = $derived(all ? section.media : section.media.slice(0, FIRST_CARDS))')
    expect(row).toContain('const near = (index: number) => { if (index >= FIRST_CARDS - 3) expand() }')
    expect(row.match(/onfocusin=\{\(\) => near\(index\)\} onpointerenter=\{expand\}/g)).toHaveLength(2)
    // A row opened once stays whole, so focus can come back to a card further along.
    expect(row).toContain('let all = $state(fullRows.has(section.id))')
  })

  it('builds on return the rows that were near the screen when the viewer left, and no more', () => {
    // Skeletons where the page reopens looked broken; rebuilding every row reached held Back ~1 s.
    expect(home).toContain('revealed = new Set(shownRows.get($catalogProvider))')
    expect(home).toContain('if (box && box.bottom > -height && box.top < height * 2) near.add(id)')
    expect(home).toContain('beforeNavigate(() => {')
  })
})
