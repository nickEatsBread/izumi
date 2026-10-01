import { get } from 'svelte/store'
import { deckKeyboardWarning, dismissDeckKeyboardWarning } from '$lib/deck/keyboard-warning'
import { isMobile } from '$lib/platform'
import { androidMiniPlayer, androidMpvActive } from '$lib/player/android-mpv'
import { seriesRatingPrompt } from '$lib/player/series-rating'
import {
  advancedFiltersOpen,
  debridCaching,
  exitPrompt,
  listEditorOpen,
  onboardingNav,
  oskDismissedAt,
  oskOpen,
  streamPicker,
  streamPickerDismissedAt,
} from '$lib/player/session'
import { closeGlobalSearch, globalSearchOpen } from '$lib/search/global-search'
import { settingsBack, settingsBackAction } from '$lib/settings/back'
import { isSettingsPath } from '$lib/settings/hierarchy'
import { closeTopNavLayer, navLayerOpen, topNavLayer } from './layers'
import { backPending, navInFlight } from './nav-state'
import { closeOsk } from './osk'
import { PAD_KEY, dispatchPadKey } from './pad-controls'
import { cancelModalDialog, openModalDialog, visibleNavTraps } from './traps'

// The layered Back (spec §3.8): one pipeline for the controller's B (gamepad.ts, browse) and the
// phone's system Back (MainActivity → window.__izumiBack, commit 11). The first layer that applies
// wins: whatever is open closes first (store-owned screens, the on-screen keyboard, the top nav
// layer, a modal dialog, a legacy trap), then an armed or nested in-page control, then the Settings
// hierarchy. The same walk, without running anything, names what B does next for the button-hint
// bar (computeBackHint / publishBackHint below). Never imports ./gamepad or ./index.

export type LayeredBackSource = 'gamepad' | 'system'
/** A Bluetooth pad's B can also raise Android's system Back: one press, two sources. */
export const BACK_DEBOUNCE_MS = 250
/** What B does next: close something, go up a level, move to the rail, leave, or ask to exit. */
export type BackHint = 'close' | 'parent' | 'rail' | 'leave' | 'exit'

interface BackPlan { hint: BackHint; run: () => boolean }
const plan = (hint: BackHint, run: () => boolean): BackPlan => ({ hint, run })

const visible = (el: HTMLElement) => el.checkVisibility?.() ?? true
/** A marker that is on: present and not "false" (Svelte writes a false expression as that text). */
const flagOn = (el: Element, name: string) => {
  const value = el.getAttribute(name)
  return value !== null && value !== 'false'
}
const isDisabled = (el: HTMLElement) => el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true'
const onHome = () => location.pathname.replace(/\/$/, '') === '/app/home'

/** The legacy trap Back belongs to: the innermost visible one holding focus, else the last. The
 *  on-screen keyboard is never one (its own step closes it). */
function legacyTrap(scope: Element | Document): HTMLElement | null {
  const traps = visibleNavTraps(scope).filter((trap) => !trap.matches('[data-osk]'))
  const focus = document.activeElement
  for (let index = traps.length - 1; index >= 0; index--) {
    if (focus && traps[index].contains(focus)) return traps[index]
  }
  return traps.at(-1) ?? null
}

const firstBack = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('[data-nav-back]')].find(visible) ?? null

/** Step 8: the Back control of the sub-view holding focus, else of the settings content. Lost focus
 *  (the body, after the focused card was replaced by the view it opened) counts as the settings
 *  content of a Settings page. */
function backTarget(focus: Element | null): HTMLElement | null {
  const el = focus instanceof HTMLElement && focus !== document.body ? focus : null
  const scope = el?.closest<HTMLElement>('[data-nav-back-scope]')
  const scoped = scope ? firstBack(scope) : null
  if (scoped) return scoped
  const surface = el
    ? el.closest<HTMLElement>('[data-nav-surface="settings"]')
    : isSettingsPath(location.pathname) ? document.querySelector<HTMLElement>('[data-nav-surface="settings"]') : null
  return surface ? firstBack(surface) : null
}

/** A pad-marked Escape dispatched at `target` itself (it bubbles on from there). */
function escapeAt(target: EventTarget): void {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  Object.defineProperty(event, PAD_KEY, { value: true })
  target.dispatchEvent(event)
}

function planBack(source: LayeredBackSource): BackPlan {
  // 1. Store-owned screens. A pad B meets these in gamepad.ts's own chain first (rows 1-3), so only
  //    the system Back runs them here; the B prompt names them for both.
  if (get(deckKeyboardWarning)) return plan('close', () => { dismissDeckKeyboardWarning(); return true })
  if (get(oskOpen)) return plan('close', () => { oskDismissedAt.set(performance.now()); closeOsk(); return true })
  const caching = get(debridCaching)
  if (caching) return plan('close', () => { caching.cancel(); return true })
  if (get(seriesRatingPrompt)) return plan('close', () => { window.dispatchEvent(new Event('series-rating-close')); return true })
  // 2. The full-screen Android player scopes the DOM lookups below (dialogs, traps) to itself.
  const fullPlayer = get(androidMpvActive) && !get(androidMiniPlayer)
  const scope: Element | Document | null = fullPlayer ? document.querySelector('[data-android-player]') : document
  // 3. The top nav layer. Not scoped: every layer that can be open over the full player (the pad
  //    chooser, a dropdown in Change source) sits above it.
  if (topNavLayer()) return plan('close', () => closeTopNavLayer('back'))
  //    Then the chain-owned screens, in gamepad.ts's order (row 6).
  if (get(globalSearchOpen)) return plan('close', () => { closeGlobalSearch(); return true })
  if (get(exitPrompt)) return plan('close', () => { exitPrompt.set(false); return true })
  const onboarding = get(onboardingNav)
  if (onboarding) {
    if (onboarding.introRunning) return plan('close', () => { window.dispatchEvent(new Event('intro-dismiss')); return true })
    if (onboarding.canGoBack) return plan('close', () => { onboarding.back(); return true })
    // The wizard's first screen stands in for Home: the pad asks before exiting, system Back exits.
    return source === 'gamepad' ? plan('exit', () => { exitPrompt.set(true); return true }) : plan('leave', () => false)
  }
  const picker = get(streamPicker)
  if (picker && !picker.hidden) {
    return plan('close', () => {
      // PlayerOverlay hears the same press: publish ownership first, as gamepad.ts does.
      streamPickerDismissedAt.set(performance.now())
      streamPicker.set(null)
      return true
    })
  }
  if (get(listEditorOpen)) return plan('close', () => { window.dispatchEvent(new Event('list-editor-close')); return true })
  if (get(advancedFiltersOpen)) return plan('close', () => { window.dispatchEvent(new Event('advanced-close')); return true })
  // 4. An open modal <dialog>: cancel it, honouring its busy guard.
  const dialog = scope ? openModalDialog() : null
  if (dialog && scope?.contains(dialog)) return plan('close', () => { cancelModalDialog(dialog); return true })
  // 5. A legacy trap (not yet a nav layer) gets today's window Escape. Back never walks history
  //    while one is on screen. A locked profile switcher has nowhere to go: the pad offers the exit
  //    prompt, the system Back does nothing.
  const trap = scope ? legacyTrap(scope) : null
  if (trap) {
    if (flagOn(trap, 'data-nav-back-exit')) return plan('exit', () => { if (source === 'gamepad') exitPrompt.set(true); return true })
    return plan('close', () => { dispatchPadKey('Escape'); return true })
  }
  // 6. The full player with nothing open keeps today's Back.
  if (fullPlayer) return plan('leave', () => false)
  const focus = document.activeElement
  // 7. An armed in-page control (a hotkey waiting for its key) cancels on an Escape at itself.
  const armed = focus instanceof HTMLElement ? focus.closest<HTMLElement>('[data-nav-escape-local]') : null
  if (armed) return plan('close', () => { escapeAt(armed); return true })
  // 8. An in-page sub-view's own Back (Themes detail, Theme Studio). A disabled one still consumes B.
  const target = backTarget(focus)
  if (target) return plan('parent', () => { if (!isDisabled(target)) target.click(); return true })
  // 9. The Settings hierarchy.
  const action = settingsBackAction(source)
  if (action) return plan(action === 'up' ? 'parent' : action, () => settingsBack(source))
  // 10. Nothing: the caller keeps today's Back (the Home exit prompt, history.back(), stock Back).
  return plan(onHome() ? 'exit' : 'leave', () => false)
}

let lastBack: { source: LayeredBackSource; at: number } | null = null

/** Step 0's debounce, shared with gamepad.ts's B edge: true (drop this press) when a DIFFERENT
 *  source fired less than BACK_DEBOUNCE_MS ago; otherwise records this press and returns false. */
export function isDuplicateBackPress(source: LayeredBackSource, now: number = performance.now()): boolean {
  if (lastBack && lastBack.source !== source && now - lastBack.at < BACK_DEBOUNCE_MS) return true
  lastBack = { source, at: now }
  return false
}

/** Spec §3.8 steps 0-10. true = consumed: the caller does nothing more. */
export function handleLayeredBack(source: LayeredBackSource): boolean {
  // 0. One press, one step: the second source of one press, or a Back while the previous one is
  //    still navigating, is consumed without looking at a page that is about to be replaced.
  if (isDuplicateBackPress(source)) return true
  if (backPending() || get(navInFlight)) return true
  const consumed = planBack(source).run()
  refreshBackHintSoon()
  return consumed
}

/** What B (default) or the system Back would do now: steps 1-10 without running anything, and
 *  without step 0's transient guards. Always the branch handleLayeredBack(source) would take. */
export function computeBackHint(source: LayeredBackSource = 'gamepad'): BackHint {
  return planBack(source).hint
}

// --- The B prompt marker (spec §3.8, agreed with the Themes session) -----------------------------
// <html data-nav-back-hint> holds what B does next; the Themes button-hint bar (ButtonHints.svelte,
// nav/hints.ts BACK_LABELS) reads it and listens for `izumi-nav-back-hint`, which fires only when
// the value changes. Absent means "the bar's own reading" (before startBackHint, after teardown).

const HINT_REFRESH_MS = [0, 300, 900] as const
let lastHint: BackHint | null = null
let hintRunning = 0
let hintTimers: ReturnType<typeof setTimeout>[] = []

/** Recompute the B prompt and publish it on <html>, announcing a change with a window event. */
export function publishBackHint(): void {
  if (typeof document === 'undefined') return
  let hint: BackHint
  try {
    hint = computeBackHint('gamepad')
  } catch {
    // A hint must never break focus handling: without the marker the bar shows its own reading.
    delete document.documentElement.dataset.navBackHint
    lastHint = null
    return
  }
  document.documentElement.dataset.navBackHint = hint
  if (hint === lastHint) return
  lastHint = hint
  window.dispatchEvent(new CustomEvent('izumi-nav-back-hint', { detail: { hint } }))
}

/** A press can replace a view without moving focus (a removed element fires no focus event), so
 *  look again once it has rendered, as the hint bar itself does. Only while startBackHint runs. */
function refreshBackHintSoon(): void {
  if (!hintRunning) return
  for (const timer of hintTimers) clearTimeout(timer)
  hintTimers = HINT_REFRESH_MS.map((ms) => setTimeout(publishBackHint, ms))
}

/** Keep the B prompt current: on focusin (after the focus settles), after every click and Back
 *  press, and whenever a layer, the keyboard or a store-owned screen opens or closes. Publishes
 *  once at once. The app layout's afterNavigate calls publishBackHint itself (nav modules never
 *  import $app/*). Returns the teardown, which removes the marker. */
export function startBackHint(): () => void {
  hintRunning++
  const publish = () => publishBackHint()
  const onFocusIn = () => queueMicrotask(publish)
  document.addEventListener('focusin', onFocusIn)
  window.addEventListener('click', refreshBackHintSoon, true)
  const stops = [
    navLayerOpen.subscribe(publish), oskOpen.subscribe(publish), deckKeyboardWarning.subscribe(publish),
    debridCaching.subscribe(publish), seriesRatingPrompt.subscribe(publish), globalSearchOpen.subscribe(publish),
    exitPrompt.subscribe(publish), onboardingNav.subscribe(publish), streamPicker.subscribe(publish),
    listEditorOpen.subscribe(publish), advancedFiltersOpen.subscribe(publish), isMobile.subscribe(publish),
    androidMpvActive.subscribe(publish), androidMiniPlayer.subscribe(publish),
  ]
  publish()
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    hintRunning--
    for (const stop of stops) stop()
    document.removeEventListener('focusin', onFocusIn)
    window.removeEventListener('click', refreshBackHintSoon, true)
    if (hintRunning) return
    for (const timer of hintTimers) clearTimeout(timer)
    hintTimers = []
    lastHint = null
    delete document.documentElement.dataset.navBackHint
  }
}

export function resetLayeredBackForTests(): void {
  lastBack = null
  lastHint = null
  hintRunning = 0
  for (const timer of hintTimers) clearTimeout(timer)
  hintTimers = []
  if (typeof document !== 'undefined') delete document.documentElement.dataset.navBackHint
}
