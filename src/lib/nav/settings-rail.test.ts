// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { isMobile } from '$lib/platform'
import { HISTORY_INDEX, recordTrail, resetHistoryTrail } from '$lib/navigation/history-trail'
import { RAIL_RETURN_ID } from '$lib/settings/back'
import { handleLayeredBack, resetLayeredBackForTests } from './back'
import { setFocusHint } from './focus-hint'
import { initDpadNav, navRect, resetNavLandingForTests } from './index'
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

// Settings › Languages in controller mode: a full-width subcategory header, then two value rows whose
// only control is the inline SelectMenu trigger, a narrow button at the row's right edge.
const valueRows = `
  <div data-nav-surface="settings" data-rect="224,0,1056,720">
    <button data-focusable data-subcategory-toggle data-rect="260,100,760,40">App and titles</button>
    <div data-setting-key="language" data-rect="260,150,760,56">
      <button data-focusable data-nav-measure-row aria-haspopup="listbox" data-rect="880,162,120,32">English</button>
    </div>
    <div data-setting-key="titleLanguage" data-rect="260,206,760,56">
      <button data-focusable data-nav-measure-row aria-haspopup="listbox" data-rect="880,218,120,32">Romaji</button>
    </div>
    <button data-focusable data-subcategory-toggle data-rect="260,280,760,40">Region</button>
  </div>`

describe('value rows with a controller', () => {
  it('Down from a full-width header lands on the inline trigger in the row below, not the next header', () => {
    document.body.innerHTML = valueRows
    el('App and titles').focus()
    press('ArrowDown')
    expect(document.activeElement).toBe(el('English'))
    press('ArrowDown')
    expect(document.activeElement).toBe(el('Romaji'))
    press('ArrowDown')
    expect(document.activeElement).toBe(el('Region'))
    press('ArrowUp')
    expect(document.activeElement).toBe(el('Romaji'))
  })

  it('navRect measures a marked trigger by its row on Up/Down only, else by its own box', () => {
    document.body.innerHTML = `${valueRows}<button data-nav-measure-row data-rect="10,10,40,20">Loose</button>`
    expect(navRect(el('English')).width).toBe(760)
    expect(navRect(el('English'), false).width).toBe(120)
    // No [data-setting-key] row around it, or no marker at all: the element's own box.
    expect(navRect(document.querySelector('button:not([data-focusable])')!).width).toBe(40)
    expect(navRect(el('Region')).width).toBe(760)
    expect(navRect(document.querySelector('[data-setting-key]')!).height).toBe(56)
  })
})

// Settings › Accounts in controller mode: a full-width switch row (its header line inside the row
// button), a row whose header line ends in two narrow buttons above two stacked fields, then a row
// whose expanded body holds a button group that wraps onto a second line.
const lineRows = `
  <div data-nav-surface="settings" data-rect="224,0,1056,720">
    <div data-setting-key="auto-watchlist" data-rect="260,100,760,56">
      <button data-focusable data-row-activate data-rect="260,100,760,56">
        <div data-nav-line data-rect="272,110,736,36">Add to Watchlist automatically</div>
      </button>
    </div>
    <div data-setting-key="kitsu-account" data-rect="260,156,760,150">
      <div data-nav-line data-rect="272,166,736,36">
        <span>Kitsu</span>
        <button data-focusable data-rect="900,168,60,32">Manage</button>
        <button data-focusable data-rect="964,168,44,32">Connect</button>
      </div>
      <input data-focusable aria-label="Username" data-rect="272,214,736,36">
      <input data-focusable aria-label="Password" data-rect="272,258,736,36">
    </div>
    <div data-setting-key="import-export-history" data-rect="260,306,760,190">
      <div data-nav-line data-rect="272,316,736,36"><span>Import and export</span></div>
      <div data-nav-line data-rect="272,364,736,80">
        <button data-focusable data-rect="272,364,260,36">Export JSON</button>
        <button data-focusable data-rect="540,364,290,36">Export XML</button>
        <button data-focusable data-rect="272,408,200,36">Import JSON</button>
      </div>
    </div>
    <button data-focusable data-subcategory-toggle data-rect="260,500,760,40">Keys</button>
  </div>`

const field = (label: string) => document.querySelector<HTMLElement>(`[aria-label="${label}"]`)!

describe('controls on a [data-nav-line] with a controller', () => {
  it('navRect measures a control on a line by the line on Up/Down only; the old marker still works outside one', () => {
    // A MultiSelect-style panel open inside a line: its options step on their own boxes.
    const openMenu = `<div data-nav-line data-rect="272,600,736,36"><div data-nav-trap data-rect="840,640,168,80">
      <button data-focusable data-rect="844,644,160,32">Option A</button></div></div>`
    document.body.innerHTML = `${lineRows}${valueRows}${openMenu}`
    expect(navRect(el('Connect')).width).toBe(736)
    expect(navRect(el('Connect')).top).toBe(166)
    expect(navRect(el('Connect'), false).width).toBe(44)
    // Closest line wins: the wrapped group, not the row's header line.
    expect(navRect(el('Import JSON')).height).toBe(80)
    // Expanded fields off any line, the row button holding a line, and a menu opened inside a line
    // all keep their own boxes.
    expect(navRect(field('Username')).top).toBe(214)
    expect(navRect(el('Add to Watchlist automatically')).width).toBe(760)
    expect(navRect(el('Option A')).width).toBe(160)
    // An inline trigger with no line around it is still measured by its [data-setting-key] row.
    expect(navRect(el('English')).width).toBe(760)
    expect(navRect(el('English'), false).width).toBe(120)
  })

  it('Down from a full-width row reaches the narrow right-aligned control on the next row\'s header line', () => {
    document.body.innerHTML = lineRows
    el('Add to Watchlist automatically').focus()
    press('ArrowDown')
    // The line's first control, then Right steps along the line on the controls' own boxes.
    expect(document.activeElement).toBe(el('Manage'))
    press('ArrowRight')
    expect(document.activeElement).toBe(el('Connect'))
    // Down leaves the line for the stacked fields below, which keep stepping one at a time.
    press('ArrowDown')
    expect(document.activeElement).toBe(field('Username'))
    press('ArrowDown')
    expect(document.activeElement).toBe(field('Password'))
    press('ArrowUp')
    expect(document.activeElement).toBe(field('Username'))
    press('ArrowUp')
    expect(document.activeElement).toBe(el('Manage'))
    press('ArrowUp')
    expect(document.activeElement).toBe(el('Add to Watchlist automatically'))
  })

  it('walks a wrapped line in reading order, so its second visual line stays reachable', () => {
    document.body.innerHTML = lineRows
    field('Password').focus()
    press('ArrowDown')
    expect(document.activeElement).toBe(el('Export JSON'))
    press('ArrowRight')
    expect(document.activeElement).toBe(el('Export XML'))
    // Nothing lies right of Export XML on screen: the next control on the line, wrapped below.
    press('ArrowRight')
    expect(document.activeElement).toBe(el('Import JSON'))
    press('ArrowLeft')
    expect(document.activeElement).toBe(el('Export XML'))
    press('ArrowDown')
    expect(document.activeElement).toBe(el('Keys'))
  })
})
