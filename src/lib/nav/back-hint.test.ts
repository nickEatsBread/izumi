// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { isMobile } from '$lib/platform'
import { androidMiniPlayer, androidMpvActive } from '$lib/player/android-mpv'
import { exitPrompt, onboardingNav, oskOpen, streamPicker } from '$lib/player/session'
import { HISTORY_INDEX, recordTrail, resetHistoryTrail } from '$lib/navigation/history-trail'
import {
  computeBackHint, handleLayeredBack, publishBackHint, resetLayeredBackForTests, startBackHint,
  type BackHint, type LayeredBackSource,
} from './back'
import { pushNavLayer, resetNavLayersForTests } from './layers'
import { clearBackPending, navInFlight } from './nav-state'
import { isPadEvent } from './pad-controls'

const mocks = vi.hoisted(() => ({ goto: vi.fn(), closeOsk: vi.fn() }))
vi.mock('$app/navigation', () => ({ goto: mocks.goto }))
vi.mock('./osk', () => ({ closeOsk: mocks.closeOsk }))
vi.mock('$lib/player/series-rating', async () => {
  const { writable } = await import('svelte/store')
  return { seriesRatingPrompt: writable(null) }
})

const byId = (id: string) => document.getElementById(id)!
const at = (path: string) => history.replaceState(null, '', path)
function visit(index: number, path: string) {
  history.replaceState({ [HISTORY_INDEX]: index }, '', path)
  recordTrail(path, 'link')
}
/** The desktop/Deck Settings layout with commit 7's markers; the rail item for the page is lit. */
function settingsPage(railHref: string, content = '<button data-focusable id="row">Row</button>') {
  document.body.innerHTML = `
    <aside data-nav-region="settings"><button data-focusable id="search">Search</button><nav data-settings-rail>
      <a href="/app/settings/player" data-focusable id="rail-player">Player</a>
      <a href="${railHref}" data-focusable data-nav-region-default aria-current="page" id="rail-current">Current</a>
    </nav></aside>
    <div data-nav-surface="settings">${content}</div>`
}

let escapes: string[] = []
let layerClose = vi.fn()
const onKeydown = (event: KeyboardEvent) => { if (event.key === 'Escape') escapes.push(isPadEvent(event) ? 'pad' : 'plain') }

interface Case {
  name: string
  hint: BackHint
  source?: LayeredBackSource
  setup: () => void
  /** The side effect of the branch the hint names, checked with handleLayeredBack's answer. */
  effect: (consumed: boolean) => void
}

const cases: Case[] = [
  {
    name: 'the on-screen keyboard is open',
    hint: 'close',
    setup: () => { oskOpen.set(true) },
    effect: (consumed) => { expect(consumed).toBe(true); expect(mocks.closeOsk).toHaveBeenCalledTimes(1) },
  },
  {
    name: 'a nav layer (a dropdown, the chooser) is open',
    hint: 'close',
    setup: () => {
      const node = document.createElement('div')
      node.setAttribute('data-nav-trap', '')
      node.setAttribute('data-nav-escape', '')
      document.body.append(node)
      pushNavLayer({ kind: 'select-menu', node: () => node, close: layerClose, restore: 'none' })
    },
    effect: (consumed) => { expect(consumed).toBe(true); expect(layerClose).toHaveBeenCalledWith('back'); expect(escapes).toEqual([]) },
  },
  {
    name: 'the trailer (a nav layer on a modal dialog, commit 3) is open',
    hint: 'close',
    source: 'system',
    setup: () => {
      document.body.innerHTML = '<dialog open id="trailer" data-nav-trap data-nav-escape aria-modal="true"></dialog>'
      const dialog = byId('trailer') as HTMLDialogElement
      dialog.close = vi.fn()
      pushNavLayer({ kind: 'trailer', node: () => dialog, close: layerClose, restore: 'none' })
    },
    effect: (consumed) => {
      expect(consumed).toBe(true)
      expect(layerClose).toHaveBeenCalledWith('back')
      expect((byId('trailer') as HTMLDialogElement).close).not.toHaveBeenCalled()
    },
  },
  {
    name: 'the source picker is open',
    hint: 'close',
    source: 'system',
    setup: () => { streamPicker.set({ hidden: false } as never) },
    effect: (consumed) => { expect(consumed).toBe(true); expect(get(streamPicker)).toBeNull() },
  },
  {
    name: 'the first-run wizard is on its first screen',
    hint: 'exit',
    setup: () => { onboardingNav.set({ canGoBack: false, back: vi.fn(), introRunning: false }) },
    effect: (consumed) => { expect(consumed).toBe(true); expect(get(exitPrompt)).toBe(true) },
  },
  {
    name: 'a modal dialog is open',
    hint: 'close',
    setup: () => {
      document.body.innerHTML = '<dialog open id="dialog"></dialog>'
      ;(byId('dialog') as HTMLDialogElement).close = vi.fn()
    },
    effect: (consumed) => { expect(consumed).toBe(true); expect((byId('dialog') as HTMLDialogElement).close).toHaveBeenCalledTimes(1) },
  },
  {
    name: 'the Themes menu drawer (a legacy trap) is open',
    hint: 'close',
    setup: () => { document.body.innerHTML = '<div role="dialog" aria-modal="true" aria-label="Menu" data-nav-trap data-nav-escape><a href="/app/home" data-focusable>Home</a></div>' },
    effect: (consumed) => { expect(consumed).toBe(true); expect(escapes).toEqual(['pad']) },
  },
  {
    name: 'a locked profile switcher is up',
    hint: 'exit',
    setup: () => {
      document.body.innerHTML = '<div role="dialog" aria-modal="true" data-nav-trap data-nav-escape data-nav-back-exit=""><button data-focusable id="main">Main</button></div>'
      byId('main').focus()
    },
    effect: (consumed) => { expect(consumed).toBe(true); expect(get(exitPrompt)).toBe(true); expect(escapes).toEqual([]) },
  },
  {
    name: 'the full-screen Android player has nothing open',
    hint: 'leave',
    source: 'system',
    setup: () => {
      androidMpvActive.set(true)
      visit(1, '/app/settings/sources')
      settingsPage('/app/settings/sources')
      document.body.insertAdjacentHTML('beforeend', '<div data-android-player></div>')
      byId('row').focus()
    },
    effect: (consumed) => { expect(consumed).toBe(false); expect(document.activeElement).toBe(byId('row')) },
  },
  {
    name: 'a hotkey is recording',
    hint: 'close',
    setup: () => {
      at('/app/settings/hotkeys')
      settingsPage('/app/settings/hotkeys', '<button data-focusable data-nav-escape-local id="rec">Press a key…</button>')
      byId('rec').addEventListener('keydown', (event) => { if (event.key === 'Escape') byId('rec').dataset.cancelled = '' })
      byId('rec').focus()
    },
    effect: (consumed) => { expect(consumed).toBe(true); expect(byId('rec').hasAttribute('data-cancelled')).toBe(true) },
  },
  {
    name: 'a Themes detail view is open',
    hint: 'parent',
    setup: () => {
      at('/app/settings/themes')
      settingsPage('/app/settings/themes', '<section data-nav-back-scope><button data-focusable data-nav-back id="back">Back to themes</button><button data-focusable id="install">Install</button></section>')
      byId('back').addEventListener('click', () => { byId('back').dataset.clicked = '' })
      byId('install').focus()
    },
    effect: (consumed) => { expect(consumed).toBe(true); expect(byId('back').hasAttribute('data-clicked')).toBe(true) },
  },
  {
    name: 'focus is on the settings rail',
    hint: 'leave',
    setup: () => {
      visit(1, '/app/home')
      visit(2, '/app/settings/sources')
      settingsPage('/app/settings/sources')
      byId('rail-player').focus()
    },
    effect: (consumed) => { expect(consumed).toBe(true); expect(history.go).toHaveBeenCalledWith(-1) },
  },
  {
    name: 'a settings sub-page (rail layout)',
    hint: 'parent',
    setup: () => {
      visit(1, '/app/settings/sources?tab=ordering')
      visit(2, '/app/settings/sources/priority')
      settingsPage('/app/settings/sources')
      byId('row').focus()
    },
    effect: (consumed) => { expect(consumed).toBe(true); expect(history.back).toHaveBeenCalledTimes(1) },
  },
  {
    name: 'focus is in the settings content (rail layout)',
    hint: 'rail',
    setup: () => {
      visit(1, '/app/settings/sources')
      settingsPage('/app/settings/sources')
      byId('row').focus()
    },
    effect: (consumed) => { expect(consumed).toBe(true); expect(document.activeElement).toBe(byId('rail-current')) },
  },
  {
    name: 'a settings page on a phone',
    hint: 'parent',
    source: 'system',
    setup: () => {
      isMobile.set(true)
      at('/app/settings/network')
      document.body.innerHTML = '<div data-nav-surface="settings"><button data-focusable id="row">Row</button></div>'
    },
    effect: (consumed) => { expect(consumed).toBe(true); expect(mocks.goto).toHaveBeenCalledWith('/app/settings', { replaceState: true }) },
  },
  {
    name: 'the settings index on a phone',
    hint: 'leave',
    source: 'system',
    setup: () => {
      isMobile.set(true)
      visit(1, '/app/home')
      visit(2, '/app/settings')
    },
    effect: (consumed) => { expect(consumed).toBe(true); expect(history.go).toHaveBeenCalledWith(-1) },
  },
  {
    name: 'Home with nothing open',
    hint: 'exit',
    setup: () => { at('/app/home') },
    effect: (consumed) => { expect(consumed).toBe(false) },
  },
  {
    name: 'any other page with nothing open',
    hint: 'leave',
    setup: () => { at('/app/series/9') },
    effect: (consumed) => { expect(consumed).toBe(false) },
  },
]

beforeEach(() => {
  resetLayeredBackForTests()
  resetNavLayersForTests()
  resetHistoryTrail()
  sessionStorage.clear()
  clearBackPending()
  navInFlight.set(false)
  isMobile.set(false)
  androidMpvActive.set(false)
  androidMiniPlayer.set(false)
  oskOpen.set(false)
  exitPrompt.set(false)
  onboardingNav.set(null)
  streamPicker.set(null)
  mocks.goto.mockReset()
  mocks.closeOsk.mockReset()
  layerClose = vi.fn()
  escapes = []
  window.addEventListener('keydown', onKeydown)
  vi.spyOn(history, 'back').mockImplementation(() => {})
  vi.spyOn(history, 'go').mockImplementation(() => {})
  at('/')
})
afterEach(() => {
  window.removeEventListener('keydown', onKeydown)
  vi.restoreAllMocks()
  resetLayeredBackForTests()
  resetNavLayersForTests()
  clearBackPending()
  document.body.replaceChildren()
})

describe('the B prompt names the branch the layered Back takes', () => {
  for (const testCase of cases) {
    it(`${testCase.name}: ${testCase.hint}`, () => {
      testCase.setup()
      const source = testCase.source ?? 'gamepad'
      expect(computeBackHint(source)).toBe(testCase.hint)
      testCase.effect(handleLayeredBack(source))
    })
  }
})

describe('publishing the B prompt', () => {
  it('sets data-nav-back-hint on <html> and announces only a change', () => {
    const heard: string[] = []
    const listener = (event: Event) => heard.push((event as CustomEvent<{ hint: string }>).detail.hint)
    window.addEventListener('izumi-nav-back-hint', listener)
    at('/app/home')
    publishBackHint()
    expect(document.documentElement.dataset.navBackHint).toBe('exit')
    publishBackHint()
    expect(heard).toEqual(['exit'])
    oskOpen.set(true)
    publishBackHint()
    expect(document.documentElement.dataset.navBackHint).toBe('close')
    expect(heard).toEqual(['exit', 'close'])
    window.removeEventListener('izumi-nav-back-hint', listener)
  })

  it('startBackHint publishes at once, on store changes and on focus changes, and cleans up', async () => {
    visit(1, '/app/settings/sources')
    settingsPage('/app/settings/sources')
    byId('row').focus()
    const stop = startBackHint()
    expect(document.documentElement.dataset.navBackHint).toBe('rail')
    exitPrompt.set(true)
    expect(document.documentElement.dataset.navBackHint).toBe('close')
    exitPrompt.set(false)
    byId('rail-player').focus()
    await Promise.resolve()
    expect(document.documentElement.dataset.navBackHint).toBe('leave')
    stop()
    expect(document.documentElement.dataset.navBackHint).toBeUndefined()
  })

  it('looks again after a press, since a view can change without any focus event', () => {
    vi.useFakeTimers()
    at('/app/settings/themes')
    settingsPage('/app/settings/themes', '<section data-nav-back-scope><button data-focusable data-nav-back id="back">Back to themes</button></section>')
    byId('back').addEventListener('click', () => byId('back').closest('section')!.remove())
    const stop = startBackHint()
    expect(document.documentElement.dataset.navBackHint).toBe('parent')
    handleLayeredBack('gamepad')
    vi.advanceTimersByTime(300)
    expect(document.documentElement.dataset.navBackHint).toBe('rail')
    stop()
    vi.useRealTimers()
  })
})
