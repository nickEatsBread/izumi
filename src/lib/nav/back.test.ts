// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { deckKeyboardWarning, warnBeforeThirdPartyLogin } from '$lib/deck/keyboard-warning'
import { isMobile } from '$lib/platform'
import { androidMiniPlayer, androidMpvActive } from '$lib/player/android-mpv'
import { seriesRatingPrompt } from '$lib/player/series-rating'
import {
  advancedFiltersOpen, debridCaching, exitPrompt, listEditorOpen, onboardingNav, oskDismissedAt, oskOpen,
  streamPicker, streamPickerDismissedAt,
} from '$lib/player/session'
import { globalSearchOpen } from '$lib/search/global-search'
import { HISTORY_INDEX, recordTrail, resetHistoryTrail } from '$lib/navigation/history-trail'
import { BACK_DEBOUNCE_MS, handleLayeredBack, isDuplicateBackPress, resetLayeredBackForTests } from './back'
import { pushNavLayer, resetNavLayersForTests } from './layers'
import { clearBackPending, markBackPending, navInFlight } from './nav-state'
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
function layer(close = vi.fn()) {
  const node = document.createElement('div')
  node.setAttribute('data-nav-trap', '')
  node.setAttribute('data-nav-escape', '')
  document.body.append(node)
  pushNavLayer({ kind: 'select-menu', node: () => node, close, restore: 'none' })
  return close
}
let windowEscapes: string[] = []
const onWindowKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') windowEscapes.push(isPadEvent(event) ? 'pad' : 'plain')
}

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
  globalSearchOpen.set(false)
  onboardingNav.set(null)
  streamPicker.set(null)
  listEditorOpen.set(false)
  advancedFiltersOpen.set(false)
  debridCaching.set(null)
  seriesRatingPrompt.set(null)
  mocks.goto.mockReset()
  mocks.closeOsk.mockReset()
  vi.spyOn(history, 'back').mockImplementation(() => {})
  vi.spyOn(history, 'go').mockImplementation(() => {})
  windowEscapes = []
  window.addEventListener('keydown', onWindowKeydown)
  at('/app/search')
})
afterEach(() => {
  window.removeEventListener('keydown', onWindowKeydown)
  vi.restoreAllMocks()
  resetNavLayersForTests()
  clearBackPending()
  document.body.replaceChildren()
})

describe('step 0: one press, one step', () => {
  it('consumes B while a Back navigation is pending or any navigation is in flight', () => {
    document.body.innerHTML = '<div data-nav-trap data-nav-escape></div>'
    markBackPending()
    expect(handleLayeredBack('gamepad')).toBe(true)
    clearBackPending()
    navInFlight.set(true)
    expect(handleLayeredBack('gamepad')).toBe(true)
    expect(windowEscapes).toEqual([])
    navInFlight.set(false)
    expect(handleLayeredBack('gamepad')).toBe(true)
    expect(windowEscapes).toEqual(['pad'])
  })

  it('drops the second source of one physical press within BACK_DEBOUNCE_MS', () => {
    document.body.innerHTML = '<div data-nav-trap data-nav-escape></div>'
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000)
    expect(handleLayeredBack('gamepad')).toBe(true)
    now.mockReturnValue(1000 + BACK_DEBOUNCE_MS - 1)
    expect(handleLayeredBack('system')).toBe(true)
    expect(windowEscapes).toEqual(['pad'])
    now.mockReturnValue(1000 + BACK_DEBOUNCE_MS)
    expect(handleLayeredBack('system')).toBe(true)
    expect(windowEscapes).toEqual(['pad', 'pad'])
  })

  it('never drops repeated presses from one source', () => {
    document.body.innerHTML = '<div data-nav-trap data-nav-escape></div>'
    vi.spyOn(performance, 'now').mockReturnValue(1000)
    handleLayeredBack('gamepad')
    handleLayeredBack('gamepad')
    expect(windowEscapes).toEqual(['pad', 'pad'])
  })

  it('isDuplicateBackPress records only the presses it lets through', () => {
    expect(isDuplicateBackPress('system', 10)).toBe(false)
    expect(isDuplicateBackPress('gamepad', 100)).toBe(true)
    expect(isDuplicateBackPress('gamepad', 300)).toBe(false)
    expect(isDuplicateBackPress('system', 400)).toBe(true)
    expect(isDuplicateBackPress('system', 600)).toBe(false)
  })
})

describe('step 1: store-owned screens (the system Back; a pad B meets them in gamepad.ts first)', () => {
  it('cancels the Deck keyboard warning', async () => {
    const answer = warnBeforeThirdPartyLogin('Example', true)
    expect(get(deckKeyboardWarning)).toEqual({ service: 'Example' })
    expect(handleLayeredBack('system')).toBe(true)
    expect(await answer).toBe(false)
    expect(get(deckKeyboardWarning)).toBeNull()
  })

  it('closes the on-screen keyboard before a layer, and stamps its dismissal for the player', () => {
    vi.spyOn(performance, 'now').mockReturnValue(4242)
    oskOpen.set(true)
    const close = layer()
    expect(handleLayeredBack('system')).toBe(true)
    expect(mocks.closeOsk).toHaveBeenCalledTimes(1)
    expect(get(oskDismissedAt)).toBe(4242)
    expect(close).not.toHaveBeenCalled()
  })

  it('cancels debrid caching and dismisses the rating prompt', () => {
    const cancel = vi.fn()
    debridCaching.set({ provider: 'p', title: 't', info: {}, cancel } as never)
    expect(handleLayeredBack('system')).toBe(true)
    expect(cancel).toHaveBeenCalledTimes(1)
    debridCaching.set(null)
    const closed = vi.fn()
    window.addEventListener('series-rating-close', closed)
    seriesRatingPrompt.set({ episode: 12 } as never)
    expect(handleLayeredBack('system')).toBe(true)
    expect(closed).toHaveBeenCalledTimes(1)
    window.removeEventListener('series-rating-close', closed)
  })
})

describe('step 3: the top nav layer, then the chain-owned screens in gamepad order', () => {
  it('closes only the top layer, even one open inside global search', () => {
    globalSearchOpen.set(true)
    const close = layer()
    expect(handleLayeredBack('system')).toBe(true)
    expect(close).toHaveBeenCalledWith('back')
    expect(get(globalSearchOpen)).toBe(true)
  })

  it('closes the trailer (TrailerDialog: a nav layer on a modal <dialog>, commit 3) as a layer, never through its native cancel', () => {
    document.body.innerHTML = '<dialog open id="trailer" data-nav-trap data-nav-escape aria-modal="true"><button data-focusable id="play">Play</button></dialog>'
    const dialog = byId('trailer') as HTMLDialogElement
    const nativeClose = vi.fn()
    dialog.close = nativeClose
    const cancelled = vi.fn()
    dialog.addEventListener('cancel', cancelled)
    const close = vi.fn()
    pushNavLayer({ kind: 'trailer', node: () => dialog, close, restore: 'none' })
    byId('play').focus()
    expect(handleLayeredBack('system')).toBe(true)
    // Step 3 wins before step 4 would cancel the same <dialog>.
    expect(close).toHaveBeenCalledWith('back')
    expect(cancelled).not.toHaveBeenCalled()
    expect(nativeClose).not.toHaveBeenCalled()
    expect(windowEscapes).toEqual([])
  })

  it('then closes global search, and the exit prompt', () => {
    globalSearchOpen.set(true)
    expect(handleLayeredBack('system')).toBe(true)
    expect(get(globalSearchOpen)).toBe(false)
    exitPrompt.set(true)
    expect(handleLayeredBack('system')).toBe(true)
    expect(get(exitPrompt)).toBe(false)
  })

  it('ends the intro and steps the first-run wizard back; its first screen offers the exit prompt to the pad only', () => {
    const back = vi.fn()
    const intro = vi.fn()
    window.addEventListener('intro-dismiss', intro)
    onboardingNav.set({ canGoBack: true, back, introRunning: true })
    expect(handleLayeredBack('system')).toBe(true)
    expect(intro).toHaveBeenCalledTimes(1)
    onboardingNav.set({ canGoBack: true, back, introRunning: false })
    expect(handleLayeredBack('system')).toBe(true)
    expect(back).toHaveBeenCalledTimes(1)
    onboardingNav.set({ canGoBack: false, back, introRunning: false })
    expect(handleLayeredBack('system')).toBe(false)
    expect(get(exitPrompt)).toBe(false)
    resetLayeredBackForTests() // a different source right after would be one press arriving twice
    expect(handleLayeredBack('gamepad')).toBe(true)
    expect(get(exitPrompt)).toBe(true)
    window.removeEventListener('intro-dismiss', intro)
  })

  it('dismisses the source picker (stamped for the player), then the list editor, then advanced filters', () => {
    vi.spyOn(performance, 'now').mockReturnValue(777)
    streamPicker.set({ hidden: false } as never)
    expect(handleLayeredBack('system')).toBe(true)
    expect(get(streamPicker)).toBeNull()
    expect(get(streamPickerDismissedAt)).toBe(777)
    const editor = vi.fn()
    const advanced = vi.fn()
    window.addEventListener('list-editor-close', editor)
    window.addEventListener('advanced-close', advanced)
    listEditorOpen.set(true)
    handleLayeredBack('system')
    listEditorOpen.set(false)
    advancedFiltersOpen.set(true)
    handleLayeredBack('system')
    expect(editor).toHaveBeenCalledTimes(1)
    expect(advanced).toHaveBeenCalledTimes(1)
    window.removeEventListener('list-editor-close', editor)
    window.removeEventListener('advanced-close', advanced)
  })

  it('leaves a hidden picker alone', () => {
    streamPicker.set({ hidden: true } as never)
    expect(handleLayeredBack('system')).toBe(false)
    expect(get(streamPicker)).toEqual({ hidden: true })
  })
})

describe('steps 4-5: dialogs and legacy traps', () => {
  it('cancels an open modal dialog that is not a layer, honouring its busy guard', () => {
    document.body.innerHTML = '<dialog open id="modal"></dialog>'
    const dialog = byId('modal') as HTMLDialogElement
    const close = vi.fn()
    dialog.close = close
    let busy = true
    dialog.addEventListener('cancel', (event) => { if (busy) event.preventDefault() })
    expect(handleLayeredBack('gamepad')).toBe(true)
    expect(close).not.toHaveBeenCalled()
    busy = false
    expect(handleLayeredBack('gamepad')).toBe(true)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('picks the trap holding focus, else the last one; a locked switcher offers the exit prompt', () => {
    document.body.innerHTML = `
      <div role="dialog" data-nav-trap data-nav-escape data-nav-back-exit id="switcher"><button data-focusable id="main">Main</button></div>
      <div role="dialog" aria-modal="true" aria-label="Menu" data-nav-trap data-nav-escape id="drawer"><a href="/app/home" data-focusable>Home</a></div>`
    byId('main').focus()
    expect(handleLayeredBack('gamepad')).toBe(true)
    expect(get(exitPrompt)).toBe(true)
    expect(windowEscapes).toEqual([])
    exitPrompt.set(false)
    ;(document.activeElement as HTMLElement).blur()
    expect(handleLayeredBack('gamepad')).toBe(true)
    expect(windowEscapes).toEqual(['pad'])
  })

  it('a locked switcher: the system Back is consumed and does nothing', () => {
    document.body.innerHTML = '<div role="dialog" data-nav-trap data-nav-escape data-nav-back-exit=""><button data-focusable id="main">Main</button></div>'
    byId('main').focus()
    expect(handleLayeredBack('system')).toBe(true)
    expect(get(exitPrompt)).toBe(false)
    expect(windowEscapes).toEqual([])
  })

  it('reads data-nav-back-exit="false" (how Svelte writes a false expression) as off', () => {
    document.body.innerHTML = '<div role="dialog" data-nav-trap data-nav-escape data-nav-back-exit="false"><button data-focusable id="main">Main</button></div>'
    byId('main').focus()
    expect(handleLayeredBack('gamepad')).toBe(true)
    expect(windowEscapes).toEqual(['pad'])
    expect(get(exitPrompt)).toBe(false)
  })

  it('never walks history while a trap is on screen, even on a Settings page', () => {
    at('/app/settings/player')
    document.body.innerHTML = '<div data-nav-trap></div><div data-nav-surface="settings"><button data-focusable id="row">Row</button></div>'
    byId('row').focus()
    expect(handleLayeredBack('gamepad')).toBe(true)
    expect(windowEscapes).toEqual(['pad'])
    expect(history.back).not.toHaveBeenCalled()
    expect(history.go).not.toHaveBeenCalled()
    expect(mocks.goto).not.toHaveBeenCalled()
  })

  it('skips a panel fading out (inert during its outro), so B reaches what is underneath', () => {
    // CatalogSwitcher's 100 ms out:fade (commit 3): the panel keeps its trap markers until it is gone.
    at('/app/home')
    document.body.innerHTML = '<div role="dialog" inert data-nav-trap data-nav-escape id="fading"><button data-focusable>Recently watched</button></div>'
    expect(handleLayeredBack('gamepad')).toBe(false) // Home with nothing else open: the caller's exit prompt
    expect(windowEscapes).toEqual([])
  })
})

describe('steps 2 and 6: the full-screen Android player', () => {
  const player = '<div data-android-player><div role="dialog" data-nav-trap data-nav-escape id="sheet"></div></div>'

  it('limits dialogs and traps to the player', () => {
    androidMpvActive.set(true)
    document.body.innerHTML = `<div data-nav-trap data-nav-escape id="behind"></div>${player}`
    expect(handleLayeredBack('system')).toBe(true)
    expect(windowEscapes).toEqual(['pad'])
    byId('sheet').remove()
    expect(handleLayeredBack('system')).toBe(false)
    expect(windowEscapes).toEqual(['pad'])
  })

  it('with nothing open keeps today’s Back, even over a Settings page', () => {
    androidMpvActive.set(true)
    isMobile.set(true)
    at('/app/settings/player')
    document.body.innerHTML = '<div data-android-player></div><div data-nav-surface="settings"><button data-focusable id="row">Row</button></div>'
    byId('row').focus()
    expect(handleLayeredBack('system')).toBe(false)
    expect(mocks.goto).not.toHaveBeenCalled()
    expect(history.back).not.toHaveBeenCalled()
  })

  it('still closes a nav layer first (the chooser sits above the player)', () => {
    androidMpvActive.set(true)
    document.body.innerHTML = player
    const close = layer()
    expect(handleLayeredBack('system')).toBe(true)
    expect(close).toHaveBeenCalledWith('back')
    expect(windowEscapes).toEqual([])
  })

  it('a docked mini-player scopes nothing', () => {
    androidMpvActive.set(true)
    androidMiniPlayer.set(true)
    document.body.innerHTML = '<div data-android-player></div><div data-nav-trap data-nav-escape></div>'
    expect(handleLayeredBack('system')).toBe(true)
    expect(windowEscapes).toEqual(['pad'])
  })

  it('without the player marker nothing is in scope', () => {
    androidMpvActive.set(true)
    document.body.innerHTML = '<div data-nav-trap data-nav-escape></div>'
    expect(handleLayeredBack('system')).toBe(false)
    expect(windowEscapes).toEqual([])
  })
})

describe('steps 7-8: in-page controls', () => {
  it('sends Escape to an armed control (a hotkey waiting for its key), at the control', () => {
    at('/app/settings/hotkeys')
    document.body.innerHTML = '<div data-nav-surface="settings"><button data-focusable data-nav-escape-local id="rec">Press a key…</button></div>'
    const seen: string[] = []
    byId('rec').addEventListener('keydown', (event) => { seen.push(event.key); event.stopPropagation() })
    byId('rec').focus()
    expect(handleLayeredBack('gamepad')).toBe(true)
    expect(seen).toEqual(['Escape'])
    expect(windowEscapes).toEqual([])
    expect(document.activeElement).toBe(byId('rec'))
  })

  it('clicks the sub-view’s own Back, and a disabled one still consumes B', () => {
    at('/app/settings/themes')
    document.body.innerHTML = `<div data-nav-surface="settings"><section data-nav-back-scope>
      <button data-focusable data-nav-back id="back">Back to themes</button>
      <button data-focusable id="install">Install &amp; apply</button></section></div>`
    const clicked = vi.fn()
    byId('back').addEventListener('click', clicked)
    byId('install').focus()
    expect(handleLayeredBack('gamepad')).toBe(true)
    expect(clicked).toHaveBeenCalledTimes(1)
    byId('back').setAttribute('disabled', '')
    expect(handleLayeredBack('gamepad')).toBe(true)
    expect(clicked).toHaveBeenCalledTimes(1)
    expect(history.back).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(byId('install'))
  })

  it('counts lost focus on a Settings page as the settings content (the focused card was replaced)', () => {
    at('/app/settings/themes')
    document.body.innerHTML = '<div data-nav-surface="settings"><section data-nav-back-scope><button data-focusable data-nav-back id="back">Back to themes</button></section></div>'
    const clicked = vi.fn()
    byId('back').addEventListener('click', clicked)
    expect(handleLayeredBack('gamepad')).toBe(true)
    expect(clicked).toHaveBeenCalledTimes(1)
  })

  it('uses a scope outside Settings too (Theme Studio over Home), and skips a Back that is not on screen', () => {
    at('/app/home')
    document.body.innerHTML = '<aside data-nav-back-scope><button data-focusable data-nav-back id="minimize">Minimize</button><input data-focusable id="hex"></aside>'
    const clicked = vi.fn()
    byId('minimize').addEventListener('click', clicked)
    byId('hex').focus()
    expect(handleLayeredBack('gamepad')).toBe(true)
    expect(clicked).toHaveBeenCalledTimes(1)
    byId('minimize').checkVisibility = () => false
    expect(handleLayeredBack('gamepad')).toBe(false) // Home with nothing else: the caller's exit prompt
    expect(clicked).toHaveBeenCalledTimes(1)
  })
})

describe('step 9: the Settings hierarchy', () => {
  it('hands a Settings page to settingsBack: from the page to its rail item', () => {
    visit(1, '/app/settings/sources')
    document.body.innerHTML = `
      <aside data-nav-region="settings"><nav data-settings-rail>
        <a href="/app/settings/sources" data-focusable data-nav-region-default aria-current="page" id="rail">Sources</a>
      </nav></aside>
      <div data-nav-surface="settings"><button data-focusable id="row">Row</button></div>`
    byId('row').focus()
    expect(handleLayeredBack('gamepad')).toBe(true)
    expect(document.activeElement).toBe(byId('rail'))
  })

  it('phone: the system Back takes a page up to its parent', () => {
    isMobile.set(true)
    visit(1, '/app/settings'); visit(2, '/app/settings/network')
    expect(handleLayeredBack('system')).toBe(true)
    expect(history.back).toHaveBeenCalledTimes(1)
  })
})

describe('step 10: nothing matched', () => {
  it('answers false so the caller keeps today’s Back', () => {
    at('/app/home')
    expect(handleLayeredBack('gamepad')).toBe(false)
    at('/app/series/9')
    expect(handleLayeredBack('gamepad')).toBe(false)
    expect(history.back).not.toHaveBeenCalled()
    expect(mocks.goto).not.toHaveBeenCalled()
  })
})
