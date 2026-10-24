// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { isMobile } from '$lib/platform'
import { HISTORY_INDEX, recordTrail, resetHistoryTrail } from '$lib/navigation/history-trail'
import { RAIL_RETURN_ID } from '$lib/settings/back'
import { handleLayeredBack, resetLayeredBackForTests } from './back'
import { setFocusHint } from './focus-hint'
import { initDpadNav, resetNavLandingForTests } from './index'
import { inputType } from './input'
import { resetNavLayersForTests } from './layers'
import { clearBackPending } from './nav-state'

const mocks = vi.hoisted(() => ({ goto: vi.fn() }))
vi.mock('$app/navigation', () => ({ goto: mocks.goto }))
vi.mock('$lib/player/series-rating', async () => {
  const { writable } = await import('svelte/store')
  return { seriesRatingPrompt: writable(null) }
})

// jsdom has no layout: every element reports the rect in its `data-rect` (left,top,width,height).
function rectOf(this: Element): DOMRect {
  const [left, top, width, height] = (this.getAttribute('data-rect') ?? '0,0,0,0').split(',').map(Number)
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect
}

// The desktop/Deck Settings layout: the aside (commit 7's region) with Search and the category rail,
// and the page content beside it.
const layout = `
  <aside data-nav-region="settings" data-rect="0,0,224,720">
    <button data-focusable data-rect="16,64,192,36">Search settings</button>
    <nav data-settings-rail data-nav-scroll-container data-rect="16,112,192,560">
      <a href="/app/settings/playback" data-focusable data-rect="16,112,192,36">Playback</a>
      <a href="/app/settings/subtitles" data-focusable data-rect="16,152,192,36">Subtitles</a>
      <a href="/app/settings/appearance" data-focusable data-nav-region-default aria-current="page" data-rect="16,192,192,36">Appearance</a>
      <a href="/app/settings/about" data-focusable data-rect="16,232,192,36">About</a>
    </nav>
  </aside>
  <div data-nav-surface="settings" data-rect="224,0,1056,720">
    <button data-focusable data-rect="260,64,160,40">Browse</button>
    <button data-focusable data-rect="260,160,300,40">Add theme</button>
    <button data-focusable data-rect="260,256,300,40">Apply</button>
  </div>`

const el = (label: string) => [...document.querySelectorAll<HTMLElement>('[data-focusable]')].find((node) => node.textContent?.trim() === label)!
const press = (key: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))

beforeAll(() => {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 720 })
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
  initDpadNav()
})

beforeEach(() => {
  Element.prototype.getBoundingClientRect = rectOf
  window.scrollBy = vi.fn() as unknown as typeof window.scrollBy
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  HTMLElement.prototype.scrollBy = vi.fn() as unknown as typeof HTMLElement.prototype.scrollBy
  HTMLElement.prototype.scrollTo = vi.fn() as unknown as typeof HTMLElement.prototype.scrollTo
  // Commit 8's focus-loss recovery (body fallback step 2) runs before the region default (step 3):
  // forget the last arrow move of the previous test, so each test's first press starts clean.
  resetNavLandingForTests()
  resetLayeredBackForTests()
  resetNavLayersForTests()
  resetHistoryTrail()
  sessionStorage.clear()
  clearBackPending()
  isMobile.set(false)
  inputType.set('dpad')
  history.replaceState({ [HISTORY_INDEX]: 1 }, '', '/app/home')
  recordTrail('/app/home', 'link')
  history.replaceState({ [HISTORY_INDEX]: 2 }, '', '/app/settings/appearance')
  recordTrail('/app/settings/appearance', 'link')
  vi.spyOn(history, 'go').mockImplementation(() => {})
  vi.spyOn(history, 'back').mockImplementation(() => {})
  document.body.innerHTML = layout
})

afterEach(() => {
  vi.restoreAllMocks()
  clearBackPending()
  setFocusHint(null)
  inputType.set('mouse')
  document.body.replaceChildren()
})

describe('the Settings rail with a controller', () => {
  it('lands the first press after a tap on the rail on the rail item, not Search', () => {
    el('Appearance').focus()
    el('Appearance').blur() // a pointer click on a rail link lets focus go (SettingsNav)
    press('ArrowDown')
    expect(document.activeElement).toBe(el('Appearance'))
  })

  it('lets a pending focus hint beat the rail default', () => {
    setFocusHint(el('Apply'))
    press('ArrowDown')
    expect(document.activeElement).toBe(el('Apply'))
  })

  it('B on the page goes to the rail item, and Right comes back to the same row', () => {
    el('Apply').focus()
    expect(handleLayeredBack('gamepad')).toBe(true)
    expect(document.activeElement).toBe(el('Appearance'))
    expect(el('Apply').dataset.navId).toBe(RAIL_RETURN_ID)
    press('ArrowRight')
    expect(document.activeElement).toBe(el('Apply'))
  })

  it('B on the rail leaves Settings for the page it was entered from', () => {
    el('Appearance').focus()
    expect(handleLayeredBack('gamepad')).toBe(true)
    expect(history.go).toHaveBeenCalledWith(-1)
  })

  it('Left from the page lands on the current category', () => {
    el('Add theme').focus()
    press('ArrowLeft')
    expect(document.activeElement).toBe(el('Appearance'))
  })

  it("keeps a row reached with Up clear of the section's pinned bar under a top bar", () => {
    // A 76 px top bar plus the 41 px sticky bar: 117 px, past the usual 86 px start margin.
    document.querySelector('[data-nav-surface]')!.insertAdjacentHTML('afterbegin', '<div data-settings-sticky data-rect="224,0,1056,117"></div>')
    const upToBrowse = () => {
      el('Add theme').focus()
      press('ArrowUp')
      expect(document.activeElement).toBe(el('Browse'))
      const [options] = vi.mocked(window.scrollBy).mock.lastCall as unknown as [ScrollToOptions]
      return options
    }
    // Hidden (the header is in view): the usual margin.
    expect(upToBrowse().top).toBeCloseTo(64 - 720 * 0.12)
    document.querySelector('[data-settings-sticky]')!.setAttribute('data-visible', '')
    expect(upToBrowse().top).toBe(64 - (117 + 16))
  })

  it('never leaves the rail vertically, and Down at the end of the page never drops into it', () => {
    el('About').focus()
    press('ArrowDown')
    expect(document.activeElement).toBe(el('About'))
    el('Apply').focus()
    press('ArrowDown')
    expect(document.activeElement).toBe(el('Apply'))
  })
})
