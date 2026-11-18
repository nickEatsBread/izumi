import { get } from 'svelte/store'
import { describe, expect, it } from 'vitest'
import { bottomBarRoom, bottomNavSuppressed, navHiddenForPlayback, suppressBottomNav } from './chrome'
import { playing } from '$lib/player/session'
import { hideSidebarWhilePlaying } from '$lib/settings/ui'
import { themeStudioPreview } from '$lib/settings/theme-studio'

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

describe('navigation while playing', () => {
  const layout = (presentation: object) => themeStudioPreview.set({ presentation } as never)

  it('tucks a sidebar, top bar or drawer away while the player is open, when the setting is on', () => {
    hideSidebarWhilePlaying.set(true)
    for (const nav of ['sidebar', 'top', 'drawer']) {
      layout({ shell: { nav } })
      playing.set(false)
      expect(get(navHiddenForPlayback)).toBe(false)
      playing.set(true)
      expect(get(navHiddenForPlayback)).toBe(true)
    }
    hideSidebarWhilePlaying.set(false)
    expect(get(navHiddenForPlayback)).toBe(false)
  })

  it('keeps a top bar around a player docked in the page', () => {
    hideSidebarWhilePlaying.set(true)
    playing.set(true)
    layout({ shell: { nav: 'top' }, player: { layout: 'docked' } })
    expect(get(navHiddenForPlayback)).toBe(false)
    playing.set(false)
    themeStudioPreview.set(null)
  })
})
