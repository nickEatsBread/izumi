// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isTv } from '$lib/platform'
import { ROUTE_FOCUS_LIMIT, rememberRouteFocus, resetFocusMemoryForTests, restoreRouteFocus, routeCardKey, routeFocusKey } from './focus-memory'
import { inputType } from './input'

let frames: FrameRequestCallback[] = []
let now = 0
const flushFrame = () => { now += 16; frames.splice(0).forEach((callback) => callback(now)) }

// Home: the same title in two rows is two different cards (Themes markers data-row + data-nav-key).
const HOME = `
  <section data-row="continue"><div data-focusable tabindex="0" data-nav-key="continue:7" aria-label="Frieren">Frieren</div></section>
  <section data-row="trending">
    <a href="/app/anime/7" data-focusable data-nav-key="media:7" aria-label="Frieren">Frieren</a>
    <a href="/app/anime/8" data-focusable data-nav-key="media:8" aria-label="Dandadan">Dandadan</a>
  </section>
  <section data-row="popular"><a href="/app/anime/7" data-focusable data-nav-key="media:7" aria-label="Frieren">Frieren</a></section>`
const card = (row: string, key: string) => document.querySelector<HTMLElement>(`[data-row="${row}"] [data-nav-key="${key}"]`)!
const byId = (id: string) => document.getElementById(id)!

beforeEach(() => {
  frames = []
  now = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  resetFocusMemoryForTests()
  inputType.set('dpad')
  isTv.set(false)
  history.replaceState(null, '', '/app/home')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  inputType.set('mouse')
  document.body.replaceChildren()
})

describe('route focus memory', () => {
  it('keys a route by its path and query', () => {
    expect(routeFocusKey(new URL('https://izumi.test/app/search?q=frieren#x'))).toBe('/app/search?q=frieren')
  })

  it('names a card by its row and its key, and nothing without both', () => {
    document.body.innerHTML = HOME
    expect(routeCardKey(card('popular', 'media:7'))).toBe('popular|media:7')
    document.body.innerHTML = '<button data-nav-key="media:1">No row</button>'
    expect(routeCardKey(document.querySelector('button')!)).toBeNull()
  })

  it('puts focus back on the same card in the same row, not the same title elsewhere', async () => {
    document.body.innerHTML = HOME
    card('popular', 'media:7').focus()
    rememberRouteFocus('/app/home')
    document.body.innerHTML = HOME // the page is rebuilt on the way back
    expect(await restoreRouteFocus('/app/home')).toBe(card('popular', 'media:7'))
    expect(document.activeElement).toBe(card('popular', 'media:7'))
  })

  it('restores at once when the control is already there, before any first-focus fallback', () => {
    document.body.innerHTML = HOME
    card('trending', 'media:8').focus()
    rememberRouteFocus('/app/home')
    document.body.innerHTML = HOME
    void restoreRouteFocus('/app/home')
    expect(document.activeElement).toBe(card('trending', 'media:8'))
  })

  it('waits for a row that renders late, overriding focus set automatically meanwhile', async () => {
    document.body.innerHTML = HOME
    card('popular', 'media:7').focus()
    rememberRouteFocus('/app/home')
    document.body.innerHTML = '<section data-row="continue"><div data-focusable tabindex="0" data-nav-key="continue:7">Frieren</div></section>'
    const pending = restoreRouteFocus('/app/home')
    flushFrame()
    // Home's own first focus (focusWhenIdle) lands on the first Continue card meanwhile.
    card('continue', 'continue:7').focus()
    flushFrame()
    document.body.insertAdjacentHTML('beforeend', '<section data-row="popular"><a href="/app/anime/7" data-focusable data-nav-key="media:7">Frieren</a></section>')
    flushFrame()
    expect(await pending).toBe(card('popular', 'media:7'))
    expect(document.activeElement).toBe(card('popular', 'media:7'))
  })

  it('falls through when the card is gone, leaving the page’s own first focus alone', async () => {
    document.body.innerHTML = HOME
    card('popular', 'media:7').focus()
    rememberRouteFocus('/app/home')
    document.body.innerHTML = `
      <section data-row="continue"><div data-focusable tabindex="0" data-nav-key="continue:9">Other</div></section>
      <section data-row="trending"><a href="/app/anime/7" data-focusable data-nav-key="media:7">Frieren</a></section>`
    const first = card('continue', 'continue:9')
    first.focus()
    const pending = restoreRouteFocus('/app/home', { timeoutMs: 100 })
    for (let frame = 0; frame < 10; frame++) flushFrame()
    expect(await pending).toBeNull()
    expect(document.activeElement).toBe(first)
  })

  it('never restores to a stand-in when a plain control is gone', async () => {
    document.body.innerHTML = '<div data-nav-surface="settings"><button data-focusable id="sync-now">Sync now</button><button data-focusable>Other</button></div>'
    byId('sync-now').focus()
    rememberRouteFocus('/app/settings/sync')
    document.body.innerHTML = '<div data-nav-surface="settings"><button data-focusable>Other</button></div>'
    const pending = restoreRouteFocus('/app/settings/sync', { timeoutMs: 50 })
    for (let frame = 0; frame < 5; frame++) flushFrame()
    expect(await pending).toBeNull()
    expect(document.activeElement).toBe(document.body)
  })

  it('finds a plain control again by what it is', async () => {
    document.body.innerHTML = '<div><button data-focusable id="sync-now">Sync now</button></div>'
    byId('sync-now').focus()
    rememberRouteFocus('/app/settings/sync')
    document.body.innerHTML = '<div><button data-focusable>Other</button><button data-focusable id="sync-now">Sync now</button></div>'
    expect(await restoreRouteFocus('/app/settings/sync')).toBe(byId('sync-now'))
    expect(document.activeElement).toBe(byId('sync-now'))
  })

  it.each(['keydown', 'pointerdown', 'click'])('gives up after a %s while it waits', async (type) => {
    document.body.innerHTML = HOME
    card('popular', 'media:7').focus()
    rememberRouteFocus('/app/home')
    document.body.innerHTML = ''
    const pending = restoreRouteFocus('/app/home')
    window.dispatchEvent(new Event(type))
    document.body.innerHTML = HOME
    flushFrame()
    expect(await pending).toBeNull()
    expect(document.activeElement).toBe(document.body)
  })

  it('stops when aborted (the next navigation started)', async () => {
    document.body.innerHTML = HOME
    card('popular', 'media:7').focus()
    rememberRouteFocus('/app/home')
    document.body.innerHTML = ''
    const controller = new AbortController()
    const pending = restoreRouteFocus('/app/home', { signal: controller.signal })
    controller.abort()
    document.body.innerHTML = HOME
    flushFrame()
    expect(await pending).toBeNull()
    expect(document.activeElement).toBe(document.body)
  })

  it('remembers for controller users only (d-pad or TV), and never an empty focus', async () => {
    document.body.innerHTML = HOME
    inputType.set('mouse')
    card('popular', 'media:7').focus()
    rememberRouteFocus('/app/home')
    expect(await restoreRouteFocus('/app/home')).toBeNull()
    isTv.set(true)
    rememberRouteFocus('/app/home')
    isTv.set(false)
    inputType.set('dpad')
    ;(document.activeElement as HTMLElement).blur()
    rememberRouteFocus('/app/home') // body: keeps what was remembered above
    document.body.innerHTML = HOME
    expect(await restoreRouteFocus('/app/home')).toBe(card('popular', 'media:7'))
  })

  it('keeps the last ROUTE_FOCUS_LIMIT routes', async () => {
    document.body.innerHTML = '<button data-focusable id="only">Only</button>'
    byId('only').focus()
    for (let route = 0; route <= ROUTE_FOCUS_LIMIT; route++) rememberRouteFocus(`/app/page/${route}`)
    expect(await restoreRouteFocus('/app/page/0')).toBeNull()
    expect(await restoreRouteFocus('/app/page/1')).toBe(byId('only'))
    expect(await restoreRouteFocus(`/app/page/${ROUTE_FOCUS_LIMIT}`)).toBe(byId('only'))
  })

  it('moves a route remembered again to the newest place', async () => {
    document.body.innerHTML = '<button data-focusable id="only">Only</button>'
    byId('only').focus()
    for (let route = 0; route < ROUTE_FOCUS_LIMIT; route++) rememberRouteFocus(`/app/page/${route}`)
    rememberRouteFocus('/app/page/0')
    rememberRouteFocus('/app/page/new')
    expect(await restoreRouteFocus('/app/page/0')).toBe(byId('only'))
    expect(await restoreRouteFocus('/app/page/1')).toBeNull()
  })

  it('focuses through the reveal it is given', async () => {
    document.body.innerHTML = HOME
    card('trending', 'media:8').focus()
    rememberRouteFocus('/app/home')
    document.body.innerHTML = HOME
    const focus = vi.fn((el: HTMLElement) => el.focus())
    await restoreRouteFocus('/app/home', { focus })
    expect(focus).toHaveBeenCalledWith(card('trending', 'media:8'))
  })
})
