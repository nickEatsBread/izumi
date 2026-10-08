// Scroll chrome: whether the app's bars are shown, slid away (`hidden`) or folded (`collapsed`),
// driven by the page's own vertical scroll. The theme's `shell.bottomNav` sets the rule (`hide`,
// `threshold`, `idle`). The state is published as `data-chrome` on <html> and read by BottomNav
// (`data-state` on `nav.bottom`), and it keeps running on pages that hide the bar, so a stylesheet
// can move `home.header` or `detail.bar` with it. Sideways rows scroll their own element, never the
// window, so they never move it.
import { get, writable, type Readable } from 'svelte/store'
import type { BottomNavPresentation } from '$lib/themes/presentation'

export type ChromeState = 'shown' | 'hidden' | 'collapsed'
export type ChromeRule = Pick<BottomNavPresentation, 'hide' | 'threshold' | 'idle'>

/** The state, the last scroll position seen, the distance scrolled since the direction last changed, and that direction. */
export interface ChromeTracker {
  state: ChromeState
  y: number
  run: number
  direction: -1 | 0 | 1
}

/** With a `threshold`, the chrome is always shown this close to the top. */
export const CHROME_TOP_ZONE = 8

export function chromeTracker(y = 0): ChromeTracker {
  return { state: 'shown', y, run: 0, direction: 0 }
}

/** The tracker after one window scroll to `y`. */
export function stepChrome(tracker: ChromeTracker, y: number, rule: ChromeRule = {}): ChromeTracker {
  if (rule.hide === 'never') return chromeTracker(y)
  const away: ChromeState = rule.hide === 'collapse' ? 'collapsed' : 'hidden'
  if (rule.threshold === undefined) {
    // izumi's own rule: more than 6 px down in one event past y 64 hides, more than 6 px up (or
    // anywhere above y 64) returns.
    const state = y > tracker.y + 6 && y > 64 ? away : y < tracker.y - 6 || y < 64 ? 'shown' : tracker.state
    return { state, y, run: 0, direction: 0 }
  }
  // The distance accumulates while the page keeps scrolling one way; a change of direction starts
  // the count again, so a jitter never flips the state.
  const delta = y - tracker.y
  const direction = delta > 0 ? 1 : delta < 0 ? -1 : tracker.direction
  const run = (direction === tracker.direction ? tracker.run : 0) + Math.abs(delta)
  let state = tracker.state
  if (y <= CHROME_TOP_ZONE) state = 'shown'
  else if (run >= rule.threshold) state = direction === 1 ? away : 'shown'
  return { state, y, run, direction }
}

const current = writable<ChromeState>('shown')
/** The published state: `shown` while the Android mini-player rests on the bar (the native video
 *  surface cannot follow the bar as it moves). */
export const scrollChrome: Readable<ChromeState> = { subscribe: current.subscribe }

let tracker = chromeTracker()
let rule: ChromeRule = {}
let docked = false
let idleTimer: ReturnType<typeof setTimeout> | undefined
let stopRunning: (() => void) | null = null

function publish(): void {
  const state = docked ? 'shown' : tracker.state
  current.set(state)
  if (typeof document !== 'undefined' && document.documentElement.dataset.chrome !== state) document.documentElement.dataset.chrome = state
}

function clearIdle(): void {
  if (idleTimer !== undefined) clearTimeout(idleTimer)
  idleTimer = undefined
}

function onScroll(): void {
  tracker = stepChrome(tracker, window.scrollY, rule)
  clearIdle()
  // `idle`: the chrome comes back after that long without scrolling (0 or absent never does).
  if (tracker.state !== 'shown' && rule.idle) {
    idleTimer = setTimeout(() => {
      idleTimer = undefined
      tracker = { ...tracker, state: 'shown', run: 0 }
      publish()
    }, rule.idle)
  }
  publish()
}

/** Back to `shown` from the current position (the shell calls this after each navigation). */
export function resetScrollChrome(): void {
  clearIdle()
  tracker = chromeTracker(typeof window === 'undefined' ? 0 : window.scrollY)
  publish()
}

/** Start following the window's scroll. `rule` is the active bar rule (`{ hide: 'never' }` where no
 *  bottom bar is in use); `dock` is true while the Android mini-player rests on the bar. */
export function startScrollChrome(options: { rule: Readable<ChromeRule | undefined>; dock: Readable<boolean> }): () => void {
  if (stopRunning || typeof window === 'undefined') return () => {}
  rule = get(options.rule) ?? {}
  docked = get(options.dock)
  resetScrollChrome()
  window.addEventListener('scroll', onScroll, { passive: true })
  const unsubscribe = [
    options.rule.subscribe((next) => {
      const value = next ?? {}
      if (value.hide === rule.hide && value.threshold === rule.threshold && value.idle === rule.idle) return
      rule = value
      resetScrollChrome()
    }),
    options.dock.subscribe((value) => {
      docked = value
      publish()
    }),
  ]
  const stop = () => {
    window.removeEventListener('scroll', onScroll)
    unsubscribe.forEach((release) => release())
    clearIdle()
    tracker = chromeTracker()
    rule = {}
    docked = false
    current.set('shown')
    delete document.documentElement.dataset.chrome
    if (stopRunning === stop) stopRunning = null
  }
  stopRunning = stop
  return stop
}
