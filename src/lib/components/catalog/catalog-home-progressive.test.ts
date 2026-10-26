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

  it('starts over for a new screen, not for a refreshed answer', () => {
    expect(home).toContain('void $catalogProvider\n    revealed = new Set()')
  })
})
