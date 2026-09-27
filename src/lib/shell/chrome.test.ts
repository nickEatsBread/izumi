import { get } from 'svelte/store'
import { describe, expect, it } from 'vitest'
import { bottomBarRoom, bottomNavSuppressed, suppressBottomNav } from './chrome'

describe('bottom navigation suppression', () => {
  it('stays hidden until every claim is released', () => {
    const first = suppressBottomNav()
    const second = suppressBottomNav()
    expect(get(bottomNavSuppressed)).toBe(true)
    first()
    first()
    expect(get(bottomNavSuppressed)).toBe(true)
    second()
    expect(get(bottomNavSuppressed)).toBe(false)
  })
  // A series page's bottom tabs sit where the navigation was, so the page keeps that room; a page
  // that only covers the navigation (`detail.nav: "hidden"`) leaves no blank band behind.
  it('keeps the room at the bottom only for a bar drawn in place of the navigation', () => {
    expect(get(bottomBarRoom)).toBe(true)
    const covered = suppressBottomNav()
    expect(get(bottomBarRoom)).toBe(false)
    const tabs = suppressBottomNav({ bar: true })
    expect(get(bottomBarRoom)).toBe(true)
    tabs()
    tabs()
    expect(get(bottomBarRoom)).toBe(false)
    covered()
    expect(get(bottomBarRoom)).toBe(true)
    expect(get(bottomNavSuppressed)).toBe(false)
  })
})
