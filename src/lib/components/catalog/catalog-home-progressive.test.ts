import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const home = readFileSync(fileURLToPath(new URL('./CatalogHome.svelte', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

// Coming back to a cached Home built every row and card in one pass (hundreds of cards held the
// Deck's page for over a second). The first screenful renders at once; the rest follow a row a frame.
describe('catalog Home builds its rows progressively', () => {
  it('shows the first rows at once and adds one row per frame', () => {
    expect(home).toContain('const FIRST_ROWS = 4')
    expect(home).toContain('shownRows += 1\n      if (shownRows < homeRowIds.length) frame = requestAnimationFrame(grow)')
  })

  it('starts over only for a new screen or a Home appearing, not for a refreshed answer', () => {
    expect(home).toContain('const hasHome = $derived(!!home)')
    expect(home).toContain('void $catalogProvider\n    if (!hasHome) return\n    shownRows = FIRST_ROWS')
  })

  it('holds each waiting row as a skeleton, and shows everything while Edit Home is open', () => {
    expect(home).toContain('{#if row && !rowShown(id)}\n          <div data-part="row.pending"')
    expect(home).toContain('const rowShown = (id: string) => $homeEditorOpen || homeRowIds.indexOf(id) < shownRows')
  })
})
