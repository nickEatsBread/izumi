import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const grid = readFileSync(fileURLToPath(new URL('./ScheduleGrid.svelte', import.meta.url)), 'utf8')
const watchlist = readFileSync(fileURLToPath(new URL('./WatchlistView.svelte', import.meta.url)), 'utf8')
const css = readFileSync(fileURLToPath(new URL('../../../app.css', import.meta.url)), 'utf8')

describe('schedule loading and motion', () => {
  it('renders animated shimmer placeholders in both schedule tabs', () => {
    expect(grid.match(/class="skeloader/g)?.length).toBeGreaterThanOrEqual(3)
    expect(watchlist).toContain('class="skeloader aspect-[2/3] rounded-lg"')
    expect(watchlist).toContain("class=\"skeloader {$watchlistLayout === 'compact' ? 'h-11' : 'h-[84px]'} rounded-lg\"")
    expect(css).not.toContain('.gamemode .skeloader::before { display: none')
  })

  it('animates loaded schedule content and controller day changes', () => {
    expect(grid).toContain('class="schedule-panel-in"')
    expect(grid).toContain('{#key selected}')
    expect(grid).toContain('class="schedule-day-in"')
    expect(css).toContain('.schedule-panel-in { animation: schedule-in')
  })
})
