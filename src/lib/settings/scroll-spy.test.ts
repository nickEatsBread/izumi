import { describe, expect, it } from 'vitest'
import { activeSubcategory, SCROLL_SPY_GAP } from './scroll-spy'

// A Playback-like page: heading tops at page offsets 140, 620 and 1400.
const page = [
  { id: 'up-next', top: 140 },
  { id: 'skipping', top: 620 },
  { id: 'advanced', top: 1400 },
]
// Under the default 2rem titlebar band, SettingsSubcategory's scroll margin lands a jumped-to heading
// 96 px below the viewport top; section-scroll.ts reads SCROLL_SPY_GAP below that.
const LINE = 96 + SCROLL_SPY_GAP
/** The tops as the viewport sees them after scrolling the window by `y`. */
const scrolledBy = (y: number) => page.map(({ id, top }) => ({ id, top: top - y }))

describe('activeSubcategory', () => {
  it('has nothing to light on a page without subcategories', () => {
    expect(activeSubcategory([], LINE)).toBeNull()
  })

  it('lights the first subcategory before any heading reaches the reading line', () => {
    expect(activeSubcategory(scrolledBy(0), LINE)).toBe('up-next')
  })

  it('lights the last subcategory whose heading has passed the line', () => {
    expect(activeSubcategory(scrolledBy(600), LINE)).toBe('skipping')
    expect(activeSubcategory(scrolledBy(1000), LINE)).toBe('skipping')
  })

  it('counts a heading sitting exactly on the line', () => {
    expect(activeSubcategory(scrolledBy(620 - LINE), LINE)).toBe('skipping')
  })

  it('keeps the line below the subcategory scroll margin, so a chip jump lights its own chip', () => {
    expect(SCROLL_SPY_GAP).toBeGreaterThan(0)
    expect(activeSubcategory(scrolledBy(1400 - 96), LINE)).toBe('advanced')
  })

  it('lights the last subcategory at the end of the page, even one too short to reach the line', () => {
    expect(activeSubcategory(scrolledBy(1000), LINE, true)).toBe('advanced')
  })

  it('takes another reading line', () => {
    expect(activeSubcategory(scrolledBy(0), 700)).toBe('skipping')
  })
})
