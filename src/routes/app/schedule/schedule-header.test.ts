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

describe('schedule page header', () => {
  it('renders the My Shows/All toggle from the header row, after the tabs and before the grid', () => {
    const headerRow = page.indexOf('bind:clientHeight={headerH}')
    const tabsButton = page.indexOf("tab = 'schedule'")
    const toggleButton = page.indexOf("pick('mine')")
    const gridUsage = page.indexOf('<ScheduleGrid')
    expect(headerRow).toBeGreaterThan(-1)
    expect(tabsButton).toBeGreaterThan(headerRow)
    expect(toggleButton).toBeGreaterThan(tabsButton)
    expect(toggleButton).toBeLessThan(gridUsage)
  })

  it('feeds the toggle state down into ScheduleGrid instead of duplicating it there', () => {
    expect(page).toContain('bind:view')
    expect(page).toContain('bind:viewTouched')
    expect(page).toContain('bind:mineCount')
    expect(grid).toContain('view = $bindable(')
  })

  it('no longer renders the My Shows toggle inside ScheduleGrid itself', () => {
    expect(grid).not.toContain("pick('mine')")
  })
})
