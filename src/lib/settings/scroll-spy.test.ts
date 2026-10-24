import { describe, expect, it } from 'vitest'
import { activeSubcategory, SCROLL_SPY_LINE } from './scroll-spy'

// A Playback-like page: heading tops at page offsets 140, 620 and 1400.
const page = [
  { id: 'up-next', top: 140 },
  { id: 'skipping', top: 620 },
  { id: 'advanced', top: 1400 },
]
/** The tops as the viewport sees them after scrolling the window by `y`. */
const scrolledBy = (y: number) => page.map(({ id, top }) => ({ id, top: top - y }))

describe('activeSubcategory', () => {
  it('has nothing to light on a page without subcategories', () => {
    expect(activeSubcategory([])).toBeNull()
  })

  it('lights the first subcategory before any heading reaches the reading line', () => {
    expect(activeSubcategory(scrolledBy(0))).toBe('up-next')
  })

  it('lights the last subcategory whose heading has passed the line', () => {
    expect(activeSubcategory(scrolledBy(600))).toBe('skipping')
    expect(activeSubcategory(scrolledBy(1000))).toBe('skipping')
  })

  it('counts a heading sitting exactly on the line', () => {
    expect(activeSubcategory(scrolledBy(620 - SCROLL_SPY_LINE))).toBe('skipping')
  })

  it('keeps the line below the subcategory scroll margin, so a chip jump lights its own chip', () => {
    // With the default 2rem titlebar band, SettingsSubcategory's scroll margin lands a jumped-to
    // heading 96 px below the viewport top.
    expect(SCROLL_SPY_LINE).toBeGreaterThan(96)
    expect(activeSubcategory(scrolledBy(1400 - 96))).toBe('advanced')
  })

  it('lights the last subcategory at the end of the page, even one too short to reach the line', () => {
    expect(activeSubcategory(scrolledBy(1000), SCROLL_SPY_LINE, true)).toBe('advanced')
  })

  it('takes another reading line', () => {
    expect(activeSubcategory(scrolledBy(0), 700)).toBe('skipping')
  })
})
