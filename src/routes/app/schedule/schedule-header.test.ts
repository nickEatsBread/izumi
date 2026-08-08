import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The My Shows/All toggle used to live on its own row inside ScheduleGrid, below the
// Schedule/Watchlist tabs — a whole extra row of a phone screen for one binary choice. It now
// renders from the page's own header row, beside the tabs, with its state bound down into
// ScheduleGrid instead of owned there.

const page = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8')
const grid = readFileSync(
  fileURLToPath(new URL('../../../lib/components/schedule/ScheduleGrid.svelte', import.meta.url)),
  'utf8',
)

// Slice out the header row: the `<div bind:clientHeight={headerH} ...>` that carries the tabs, the
// My Shows/All toggle, and the week nav, up to its matching closing `</div>`. Depth-counts nested
// `<div`/`</div>` tags rather than trusting `indexOf` offsets, so the slice is the actual header
// row markup and not just "whatever text happens to come after this string" — a plain ordering
// check on raw offsets still passes if the toggle gets pulled out into its own row underneath.
function headerRowSlice(source: string): string {
  const openTag = 'bind:clientHeight={headerH}'
  const openIdx = source.indexOf(openTag)
  expect(openIdx).toBeGreaterThan(-1)
  const divStart = source.lastIndexOf('<div', openIdx)
  expect(divStart).toBeGreaterThan(-1)

  const divOpen = /<div\b/g
  const divClose = /<\/div>/g
  divOpen.lastIndex = divStart
  divClose.lastIndex = divStart
  let depth = 0
  let cursor = divStart
  while (true) {
    divOpen.lastIndex = cursor
    divClose.lastIndex = cursor
    const nextOpen = divOpen.exec(source)
    const nextClose = divClose.exec(source)
    expect(nextClose).not.toBeNull()
    if (nextOpen && nextOpen.index < (nextClose as RegExpExecArray).index) {
      depth += 1
      cursor = nextOpen.index + 1
    } else {
      depth -= 1
      cursor = (nextClose as RegExpExecArray).index + (nextClose as RegExpExecArray)[0].length
      if (depth === 0) return source.slice(divStart, cursor)
    }
  }
}

describe('schedule page header', () => {
  it('renders both tabs and both My Shows/All options inside the same header row', () => {
    const headerRow = headerRowSlice(page)
    // Both tabs.
    expect(headerRow).toContain("tab = 'schedule'")
    expect(headerRow).toContain("tab = 'watchlist'")
    // Both toggle options — this is the part that regresses if the toggle is pulled back out into
    // its own row below the header, since it would then fall outside the matched slice.
    expect(headerRow).toContain("pick('mine')")
    expect(headerRow).toContain("pick('all')")
  })

  it('feeds the toggle state down into ScheduleGrid instead of duplicating it there', () => {
    expect(page).toContain('bind:view')
    expect(page).toContain('bind:viewTouched')
    expect(page).toContain('onMineCount')
    expect(grid).toContain('view = $bindable(')
    expect(grid).toContain('onMineCount')
  })

  it('no longer renders the My Shows toggle inside ScheduleGrid itself', () => {
    expect(grid).not.toContain("pick('mine')")
  })
})
