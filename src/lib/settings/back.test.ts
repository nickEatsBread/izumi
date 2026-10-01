// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isMobile } from '$lib/platform'
import { backPending, clearBackPending } from '$lib/nav/nav-state'
import { HISTORY_INDEX, recordTrail, resetHistoryTrail } from '$lib/navigation/history-trail'
import { RAIL_RETURN_ID, focusRailItem, goUp, leaveSettings, settingsBack, settingsBackAction } from './back'

const mocks = vi.hoisted(() => ({ goto: vi.fn() }))
vi.mock('$app/navigation', () => ({ goto: mocks.goto }))

/** Stand in for SvelteKit: the entry index in history.state, then the layout's trail record. */
function visit(index: number, path: string, type = 'link') {
  history.replaceState({ [HISTORY_INDEX]: index }, '', path)
  recordTrail(path, type)
}

// The desktop/Deck layout with commit 7's markers: the aside region, the rail list, the content.
const RAIL = `
  <aside data-nav-region="settings">
    <button data-focusable id="search">Search settings</button>
    <nav data-settings-rail data-nav-scroll-container>
      <a href="/app/settings/player" data-focusable id="rail-player">Player</a>
      <a href="/app/settings/sources" data-focusable id="rail-sources">Sources</a>
      <a href="/app/settings/themes" data-focusable id="rail-themes">Themes</a>
    </nav>
  </aside>`
function page(activeRail: string | null, content = '<button data-focusable id="row">Row</button><button data-focusable id="other">Other</button>') {
  document.body.innerHTML = `${RAIL}<div data-nav-surface="settings">${content}</div>`
  if (!activeRail) return
  const link = document.getElementById(activeRail)!
  link.setAttribute('data-nav-region-default', '')
  link.setAttribute('aria-current', 'page')
}
const byId = (id: string) => document.getElementById(id)!

beforeEach(() => {
  resetHistoryTrail()
  sessionStorage.clear()
  clearBackPending()
  isMobile.set(false)
  mocks.goto.mockReset()
  vi.spyOn(history, 'back').mockImplementation(() => {})
  vi.spyOn(history, 'go').mockImplementation(() => {})
  history.replaceState(null, '', '/')
})
afterEach(() => {
  vi.restoreAllMocks()
  clearBackPending()
  document.body.replaceChildren()
})

describe('settingsBackAction', () => {
  it('rail layout: the aside and the rail leave, a page goes to its rail item, a sub-page goes up', () => {
    page('rail-sources')
    history.replaceState(null, '', '/app/settings/sources')
    byId('search').focus()
    expect(settingsBackAction('gamepad')).toBe('leave')
    byId('rail-player').focus()
    expect(settingsBackAction('gamepad')).toBe('leave')
    byId('row').focus()
    expect(settingsBackAction('gamepad')).toBe('rail')
    history.replaceState(null, '', '/app/settings/sources/priority')
    expect(settingsBackAction('gamepad')).toBe('up')
  })

  it('rail layout on TV (no rail region): the rail list alone counts as the rail', () => {
    page('rail-sources')
    byId('search').closest('aside')!.removeAttribute('data-nav-region')
    history.replaceState(null, '', '/app/settings/sources')
    byId('rail-player').focus()
    expect(settingsBackAction('gamepad')).toBe('leave')
    byId('row').focus()
    expect(settingsBackAction('gamepad')).toBe('rail')
  })

  it('rail layout on a page the rail has no item for (Navigation) leaves', () => {
    page(null)
    history.replaceState(null, '', '/app/settings/navigation')
    byId('row').focus()
    expect(settingsBackAction('gamepad')).toBe('leave')
  })

  it('phone layout: the index leaves, every page and sub-page goes up', () => {
    isMobile.set(true)
    document.body.innerHTML = '<div data-nav-surface="settings"><button data-focusable id="row">Row</button></div>'
    byId('row').focus()
    const expected: Array<[string, string]> = [
      ['/app/settings', 'leave'],
      ['/app/settings/player', 'up'],
      ['/app/settings/store', 'up'],
      ['/app/settings/about/license-information', 'up'],
    ]
    for (const [path, action] of expected) {
      history.replaceState(null, '', path)
      expect(settingsBackAction('system'), path).toBe(action)
    }
  })

  it('the phone header arrow always goes up', () => {
    history.replaceState(null, '', '/app/settings/player')
    expect(settingsBackAction('header')).toBe('up')
  })

  it('is null outside Settings, and settingsBack then does nothing', () => {
    history.replaceState(null, '', '/app/home')
    expect(settingsBackAction('gamepad')).toBeNull()
    expect(settingsBack('gamepad')).toBe(false)
    expect(mocks.goto).not.toHaveBeenCalled()
    expect(history.go).not.toHaveBeenCalled()
  })
})

describe('goUp', () => {
  it('returns through history when the previous page is the parent', () => {
    visit(1, '/app/settings/sources?tab=ordering')
    visit(2, '/app/settings/sources/priority')
    goUp()
    expect(history.back).toHaveBeenCalledTimes(1)
    expect(mocks.goto).not.toHaveBeenCalled()
    expect(backPending()).toBe(true)
  })

  it('replaces the entry with the structural parent after a cross-link (decision 8)', () => {
    visit(1, '/app/collections')
    visit(2, '/app/settings/catalog/collections')
    goUp()
    expect(history.back).not.toHaveBeenCalled()
    expect(mocks.goto).toHaveBeenCalledWith('/app/settings/catalog', { replaceState: true })
  })

  it('accepts Catalog as the Store parent, and Customize Home as the Collections parent', () => {
    visit(1, '/app/settings/catalog'); visit(2, '/app/settings/store')
    goUp()
    expect(history.back).toHaveBeenCalledTimes(1)
    visit(1, '/app/settings/catalog/home'); visit(2, '/app/settings/catalog/collections')
    goUp()
    expect(history.back).toHaveBeenCalledTimes(2)
    expect(mocks.goto).not.toHaveBeenCalled()
  })

  it('with no trail (a fresh start on a sub-page) goes to the parent tab, replacing', () => {
    history.replaceState({ [HISTORY_INDEX]: 5 }, '', '/app/settings/store')
    goUp()
    expect(mocks.goto).toHaveBeenCalledWith('/app/settings/sources?tab=manage', { replaceState: true })
  })
})

describe('leaveSettings', () => {
  it('walks history back to the page before Settings', () => {
    visit(1, '/app/series/9'); visit(2, '/app/settings'); visit(3, '/app/settings/sources'); visit(4, '/app/settings/sources/priority')
    leaveSettings()
    expect(history.go).toHaveBeenCalledWith(-3)
    expect(backPending()).toBe(true)
  })

  it('without a usable trail goes to where Settings was entered from, else Home, replacing', () => {
    visit(1, '/app/series/9'); visit(2, '/app/settings')
    history.replaceState({ [HISTORY_INDEX]: 9 }, '', '/app/settings/player') // an entry the trail never saw
    leaveSettings()
    expect(mocks.goto).toHaveBeenCalledWith('/app/series/9', { replaceState: true })
    resetHistoryTrail()
    leaveSettings()
    expect(mocks.goto).toHaveBeenLastCalledWith('/app/home', { replaceState: true })
    expect(history.go).not.toHaveBeenCalled()
  })
})

describe('focusRailItem', () => {
  it('focuses the active rail link and marks the row B came from, for Right to return to', () => {
    page('rail-themes')
    byId('row').focus()
    expect(focusRailItem()).toBe(true)
    expect(document.activeElement).toBe(byId('rail-themes'))
    expect(byId('row').dataset.navId).toBe(RAIL_RETURN_ID)
    expect(byId('rail-themes').dataset.navRight).toBe(RAIL_RETURN_ID)
  })

  it('moves the mark to the newest row, off the old one', () => {
    page('rail-themes')
    byId('row').focus(); focusRailItem()
    byId('other').focus(); focusRailItem()
    expect(byId('row').hasAttribute('data-nav-id')).toBe(false)
    expect(byId('other').dataset.navId).toBe(RAIL_RETURN_ID)
  })

  it('keeps a row’s own nav id and points the rail link at it', () => {
    page('rail-themes', '<button data-focusable id="row" data-nav-id="theme-grid-first">Row</button>')
    byId('row').focus(); focusRailItem()
    expect(byId('row').dataset.navId).toBe('theme-grid-first')
    expect(byId('rail-themes').dataset.navRight).toBe('theme-grid-first')
  })

  it('marks nothing when B came from outside the settings content', () => {
    page('rail-themes')
    byId('row').focus(); focusRailItem()
    document.body.insertAdjacentHTML('beforeend', '<nav data-nav-sidebar><a href="/app/home" data-focusable id="side">Home</a></nav>')
    byId('side').focus()
    expect(focusRailItem()).toBe(true)
    expect(byId('side').hasAttribute('data-nav-id')).toBe(false)
    expect(byId('row').hasAttribute('data-nav-id')).toBe(false)
    expect(byId('rail-themes').hasAttribute('data-nav-right')).toBe(false)
  })

  it('falls back to aria-current without the region default (TV), and fails without either', () => {
    page('rail-sources')
    byId('rail-sources').removeAttribute('data-nav-region-default')
    byId('row').focus()
    expect(focusRailItem()).toBe(true)
    expect(document.activeElement).toBe(byId('rail-sources'))
    page(null)
    byId('row').focus()
    expect(focusRailItem()).toBe(false)
    expect(document.activeElement).toBe(byId('row'))
  })
})

describe('settingsBack', () => {
  it('runs the action it names: page → rail item, then rail → out of Settings', () => {
    page('rail-themes')
    visit(1, '/app/home'); visit(2, '/app/settings/themes')
    byId('row').focus()
    expect(settingsBack('gamepad')).toBe(true)
    expect(document.activeElement).toBe(byId('rail-themes'))
    expect(settingsBack('gamepad')).toBe(true)
    expect(history.go).toHaveBeenCalledWith(-1)
  })
})
