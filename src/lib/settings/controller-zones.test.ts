// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { isMobile, isTv } from '$lib/platform'
import { gameMode, playing } from '$lib/player/session'
import { HISTORY_INDEX, recordTrail, resetHistoryTrail } from '$lib/navigation/history-trail'
import { initDpadNav, resetNavLandingForTests } from '$lib/nav'
import { resetLayeredBackForTests } from '$lib/nav/back'
import { inputType } from '$lib/nav/input'
import { resetNavLayersForTests } from '$lib/nav/layers'
import { clearBackPending, navEpoch } from '$lib/nav/nav-state'
import { dispatchPadKey, resetPadControlsForTests } from '$lib/nav/pad-controls'
import {
  RAIL_PREVIEW_MS, controllerLanded, installControllerZones, paneEntryTarget, resetControllerZonesForTests, scrollEdges,
} from './controller-zones'
import { leaveSettings } from './back'

// NuvioTV's two focus zones in controller Settings (spec §5.2), on the markup the controller layout
// renders: the app sidebar, the settings rail (its own region) and the pane. A section switch is a
// mocked goto that does what the app does: relight the rail and swap the pane's page.

const mocks = vi.hoisted(() => ({ goto: vi.fn() }))
vi.mock('$app/navigation', () => ({ goto: mocks.goto }))
vi.mock('$lib/player/series-rating', async () => {
  const { writable } = await import('svelte/store')
  return { seriesRatingPrompt: writable(null) }
})

function rectOf(this: Element): DOMRect {
  const [left, top, width, height] = (this.getAttribute('data-rect') ?? '0,0,0,0').split(',').map(Number)
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect
}

const SECTIONS = ['playback', 'subtitles', 'languages'] as const
type Section = (typeof SECTIONS)[number]
const TITLES: Record<Section, string> = { playback: 'Playback', subtitles: 'Subtitles', languages: 'Languages' }
const ROWS: Record<Section, string[]> = {
  playback: ['Auto-play next episode', 'Skip intros'],
  subtitles: ['Use custom style', 'Text size'],
  languages: ['App language', 'Audio language'],
}

const pane = (section: Section) => `
  <div data-settings-section="${section}">
    <section data-settings-subcategory="first">
      <h3><button type="button" data-focusable data-subcategory-toggle data-rect="352,47,540,40">${TITLES[section]} basics</button></h3>
      <div data-settings-subcategory-body>
        ${ROWS[section].map((label, index) => `<div data-setting-key="${section}-${index}"><button type="button" data-focusable data-row-activate data-rect="352,${95 + index * 64},540,56">${label}</button></div>`).join('')}
        ${section === 'subtitles' ? '<div data-setting-key="subtitle-scale"><input data-focusable aria-label="Scale" type="range" min="0" max="10" step="1" value="5" data-rect="640,240,252,24"></div>' : ''}
      </div>
    </section>
  </div>`

/** What a section switch does in the app: the rail lights the section and the pane shows its page. */
function show(section: Section) {
  for (const link of document.querySelectorAll<HTMLElement>('[data-settings-rail] a')) {
    const on = link.dataset.section === section
    link.toggleAttribute('data-nav-region-default', on)
    if (on) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  }
  document.querySelector('[data-settings-pane]')!.innerHTML = pane(section)
  history.replaceState({ [HISTORY_INDEX]: 2 }, '', `/app/settings/${section}`)
}

function mount(section: Section): HTMLElement {
  document.body.innerHTML = `
    <nav data-nav-sidebar data-slot="nav.side">
      <a href="/app/home" data-focusable data-rect="0,60,72,44">Home</a>
      <a href="/app/settings" data-focusable data-nav-region-default aria-current="page" data-rect="0,480,72,44">Settings</a>
    </nav>
    <div data-settings-controller data-rect="72,0,888,540">
      <aside data-nav-region="settings" data-rect="96,27,220,486">
        <div data-settings-search><button type="button" data-focusable aria-label="Search settings" data-rect="96,27,220,40"></button></div>
        <nav data-settings-rail data-nav-scroll-container data-nav-scroll-pivot="0.42" data-rect="96,75,220,438">
          ${SECTIONS.map((id, index) => `<a href="/app/settings/${id}" data-section="${id}" data-focusable data-rect="96,${75 + index * 58},220,54">${TITLES[id]}</a>`).join('')}
        </nav>
      </aside>
      <div data-settings-pane data-nav-surface="settings" data-nav-scroll-container data-nav-scroll-pivot="0.42" data-rect="332,27,580,486"></div>
    </div>`
  show(section)
  return document.querySelector<HTMLElement>('[data-settings-controller]')!
}

const rail = (section: Section) => document.querySelector<HTMLElement>(`[data-settings-rail] [data-section="${section}"]`)!
const row = (label: string) => [...document.querySelectorAll<HTMLElement>('[data-settings-pane] [data-focusable]')]
  .find((node) => (node.getAttribute('aria-label') ?? node.textContent?.trim()) === label)!
const press = (key: string) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  window.dispatchEvent(event)
  return event
}
const settle = async () => { for (let turn = 0; turn < 10; turn++) await Promise.resolve() }
const url = (path: string) => new URL(path, 'http://localhost')
const SWITCH = { replaceState: true, keepFocus: true, noScroll: true }

let root: HTMLElement
let uninstall: () => void = () => {}

beforeAll(() => {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 540 })
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 960 })
  initDpadNav()
})

beforeEach(() => {
  Element.prototype.getBoundingClientRect = rectOf
  window.scrollBy = vi.fn() as unknown as typeof window.scrollBy
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  HTMLElement.prototype.scrollBy = vi.fn() as unknown as HTMLElement['scrollBy']
  HTMLElement.prototype.scrollTo = vi.fn() as unknown as HTMLElement['scrollTo']
  resetNavLandingForTests()
  resetLayeredBackForTests()
  resetNavLayersForTests()
  resetPadControlsForTests()
  resetControllerZonesForTests()
  resetHistoryTrail()
  sessionStorage.clear()
  clearBackPending()
  isMobile.set(false)
  isTv.set(false)
  gameMode.set(true)
  playing.set(false)
  inputType.set('dpad')
  history.replaceState({ [HISTORY_INDEX]: 1 }, '', '/app/home')
  recordTrail('/app/home', 'link')
  history.replaceState({ [HISTORY_INDEX]: 2 }, '', '/app/settings/subtitles')
  recordTrail('/app/settings/subtitles', 'link')
  vi.spyOn(history, 'go').mockImplementation(() => {})
  vi.spyOn(history, 'back').mockImplementation(() => {})
  mocks.goto.mockReset()
  mocks.goto.mockImplementation(async (href: string) => {
    const id = href.split(/[/?#]/).filter(Boolean).pop() as Section
    if (SECTIONS.includes(id)) show(id)
  })
  root = mount('subtitles')
  uninstall = installControllerZones(root)
})

afterEach(() => {
  uninstall()
  uninstall = () => {}
  vi.useRealTimers()
  vi.restoreAllMocks()
  gameMode.set(false)
  inputType.set('mouse')
  document.body.replaceChildren()
})

describe('rail preview', () => {
  it('Down moves focus at once and shows that section 140 ms later, replacing the history entry', () => {
    vi.useFakeTimers()
    rail('subtitles').focus()
    press('ArrowDown')
    expect(document.activeElement).toBe(rail('languages'))
    vi.advanceTimersByTime(RAIL_PREVIEW_MS - 1)
    expect(mocks.goto).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(mocks.goto).toHaveBeenCalledTimes(1)
    expect(mocks.goto).toHaveBeenCalledWith('/app/settings/languages', SWITCH)
    expect(document.activeElement).toBe(rail('languages'))
  })

  it('a quick run through the rail shows only where it stops, and the lit item shows nothing', () => {
    vi.useFakeTimers()
    rail('playback').focus()
    vi.advanceTimersByTime(50)
    press('ArrowDown')
    expect(document.activeElement).toBe(rail('subtitles'))
    vi.advanceTimersByTime(50)
    press('ArrowDown')
    vi.advanceTimersByTime(RAIL_PREVIEW_MS)
    expect(mocks.goto).toHaveBeenCalledTimes(1)
    expect(mocks.goto).toHaveBeenCalledWith('/app/settings/languages', SWITCH)
  })

  it('Left from the rail opens the app strip on the active destination and drops a waiting preview', () => {
    vi.useFakeTimers()
    rail('subtitles').focus()
    press('ArrowDown')
    press('ArrowLeft')
    expect(document.activeElement?.textContent).toBe('Settings')
    vi.advanceTimersByTime(RAIL_PREVIEW_MS)
    expect(mocks.goto).not.toHaveBeenCalled()
  })

  it('a Back from the rail, or any other navigation, drops a waiting preview while focus stays put', () => {
    vi.useFakeTimers()
    rail('subtitles').focus()
    press('ArrowDown')
    leaveSettings()
    vi.advanceTimersByTime(RAIL_PREVIEW_MS)
    expect(history.go).toHaveBeenCalledWith(-1)
    clearBackPending()
    rail('subtitles').focus()
    press('ArrowDown')
    navEpoch.update((epoch) => epoch + 1)
    vi.advanceTimersByTime(RAIL_PREVIEW_MS)
    expect(mocks.goto).not.toHaveBeenCalled()
  })

  it('uninstalling drops a waiting preview and hands the rail and the pane back to the engine', () => {
    vi.useFakeTimers()
    rail('subtitles').focus()
    press('ArrowDown')
    uninstall()
    vi.advanceTimersByTime(RAIL_PREVIEW_MS)
    row('Text size').focus()
    rail('languages').focus()
    press('ArrowRight')
    vi.advanceTimersByTime(RAIL_PREVIEW_MS)
    expect(mocks.goto).not.toHaveBeenCalled()
    expect(document.activeElement).not.toBe(rail('languages'))
    const seen: boolean[] = []
    document.addEventListener('click', (event) => { seen.push(event.defaultPrevented); event.preventDefault() }, { once: true })
    rail('languages').click()
    expect(seen).toEqual([false])
    uninstall = installControllerZones(root)
    rail('subtitles').focus()
    press('ArrowRight')
    expect(document.activeElement).toBe(row('Subtitles basics'))
  })
})

describe('entering and leaving the pane', () => {
  it('Right from the lit rail item enters on the pane’s first control', () => {
    rail('subtitles').focus()
    press('ArrowRight')
    expect(document.activeElement).toBe(row('Subtitles basics'))
  })

  it('…and on the row last used on that page when there is one', () => {
    row('Text size').focus()
    rail('subtitles').focus()
    press('ArrowRight')
    expect(document.activeElement).toBe(row('Text size'))
  })

  it('Right on a section still waiting to show switches now, and each page keeps its own row', async () => {
    row('Text size').focus()
    rail('subtitles').focus()
    press('ArrowDown')
    press('ArrowRight')
    await settle()
    expect(mocks.goto).toHaveBeenCalledTimes(1)
    expect(mocks.goto).toHaveBeenCalledWith('/app/settings/languages', SWITCH)
    expect(document.activeElement).toBe(row('Languages basics'))
    press('ArrowLeft')
    expect(document.activeElement).toBe(rail('languages'))
    press('ArrowUp')
    press('ArrowRight')
    await settle()
    expect(document.activeElement).toBe(row('Text size'))
  })

  it('a slow switch starts once however often Right repeats, and moving on keeps focus in the rail', async () => {
    const loads: Array<() => void> = []
    mocks.goto.mockImplementation((href: string) => new Promise<void>((resolve) => {
      loads.push(() => { show(href.split('/').pop() as Section); resolve() })
    }))
    rail('subtitles').focus()
    press('ArrowDown')
    press('ArrowRight')
    press('ArrowRight')
    expect(mocks.goto).toHaveBeenCalledTimes(1)
    press('ArrowUp')
    loads[0]()
    await settle()
    expect(rail('languages').getAttribute('aria-current')).toBe('page')
    expect(document.activeElement).toBe(rail('subtitles'))
  })

  it('the bare landing keeps its rows under Playback, the section it shows', () => {
    show('playback')
    history.replaceState({ [HISTORY_INDEX]: 2 }, '', '/app/settings')
    row('Skip intros').focus()
    show('playback')
    rail('playback').focus()
    press('ArrowRight')
    expect(document.activeElement).toBe(row('Skip intros'))
  })

  it('A on a rail item enters the pane; a tap or a mouse click stays a plain link', async () => {
    rail('languages').click()
    await settle()
    expect(mocks.goto).toHaveBeenCalledWith('/app/settings/languages', SWITCH)
    expect(document.activeElement).toBe(row('Languages basics'))
    const seen: boolean[] = []
    document.addEventListener('click', (event) => { seen.push(event.defaultPrevented); event.preventDefault() }, { once: true })
    rail('playback').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
    expect(seen).toEqual([false])
  })

  it('Left inside the pane steps a slider before it ever leaves for the rail', () => {
    const slider = row('Scale') as HTMLInputElement
    slider.focus()
    dispatchPadKey('ArrowLeft')
    expect(document.activeElement).toBe(slider)
    expect(slider.value).toBe('4')
  })

  it('Left at the pane’s edge returns to the lit rail item, not the nearest one', () => {
    row('Text size').focus()
    press('ArrowLeft')
    expect(document.activeElement).toBe(rail('subtitles'))
  })

  it('paneEntryTarget falls back to the first control when the remembered row is gone', () => {
    row('Text size').focus()
    document.querySelector('[data-setting-key="subtitles-1"]')!.remove()
    expect(paneEntryTarget(document.querySelector('[data-settings-pane]')!)).toBe(row('Subtitles basics'))
  })
})

describe('entering Settings', () => {
  it('focuses the lit rail item when Settings is entered with a pad or a remote', async () => {
    await controllerLanded({ type: 'link', from: url('/app/home'), to: url('/app/settings/subtitles') }, root)
    expect(document.activeElement).toBe(rail('subtitles'))
  })

  it('opens the section remembered from earlier in the session instead of the bare landing', async () => {
    show('languages')
    await controllerLanded({ type: 'goto', from: url('/app/settings/subtitles'), to: url('/app/settings/languages') }, root)
    show('playback')
    history.replaceState({ [HISTORY_INDEX]: 2 }, '', '/app/settings')
    await controllerLanded({ type: 'link', from: url('/app/home'), to: url('/app/settings') }, root)
    expect(mocks.goto).toHaveBeenCalledWith('/app/settings/languages', { replaceState: true, noScroll: true })
    expect(document.activeElement).toBe(rail('languages'))
  })

  it('a search hit on the bare landing keeps its reveal instead of opening the remembered section', async () => {
    show('languages')
    await controllerLanded({ type: 'goto', from: url('/app/settings/subtitles'), to: url('/app/settings/languages') }, root)
    await controllerLanded({ type: 'link', from: url('/app/home'), to: url('/app/settings?setting=text-size') }, root)
    await controllerLanded({ type: 'link', from: url('/app/home'), to: url('/app/settings#text-size') }, root)
    expect(mocks.goto).not.toHaveBeenCalled()
  })

  it('leaves focus alone after a history step, a search hit, or a touch', async () => {
    await controllerLanded({ type: 'popstate', from: url('/app/home'), to: url('/app/settings/subtitles') }, root)
    expect(document.activeElement).toBe(document.body)
    await controllerLanded({ type: 'link', from: url('/app/home'), to: url('/app/settings/subtitles?setting=text-size') }, root)
    expect(document.activeElement).toBe(document.body)
    inputType.set('touch')
    await controllerLanded({ type: 'link', from: url('/app/home'), to: url('/app/settings/subtitles') }, root)
    expect(document.activeElement).toBe(document.body)
  })
})

describe('scrollEdges', () => {
  it('reports the edges with more content past them', () => {
    expect(scrollEdges({ scrollTop: 0, clientHeight: 400, scrollHeight: 400 })).toEqual({ up: false, down: false })
    expect(scrollEdges({ scrollTop: 0, clientHeight: 400, scrollHeight: 900 })).toEqual({ up: false, down: true })
    expect(scrollEdges({ scrollTop: 250, clientHeight: 400, scrollHeight: 900 })).toEqual({ up: true, down: true })
    expect(scrollEdges({ scrollTop: 500, clientHeight: 400, scrollHeight: 900 })).toEqual({ up: true, down: false })
  })
})
