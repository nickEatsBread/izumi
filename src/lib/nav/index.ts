import { get } from 'svelte/store'
import { gameMode, playing } from '$lib/player/session'
import { isTv } from '$lib/platform'
import { controllerMode } from './input'
import { pickInDirection, type Dir } from './spatial'
export * from './input'
export * from './actions'
export * from './spatial'
export * from './browser-gamepad'

interface ElCand { id: string; rect: DOMRect; el: HTMLElement }

// A text field auto-opens the on-screen keyboard on focus (Deck) and captures the arrows, so it
// must never be the AUTO-landing target — the user reaches it deliberately, not by entering a page.
const isTextInput = (el: HTMLElement) =>
  el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable

export type ArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'

// Only the bits of the focused element the ownership rules below depend on, so those rules stay a
// pure function (the test env has no DOM) and the DOM reading happens in exactly one place.
export interface FieldShape { tag: string; type?: string; contentEditable?: boolean; role?: string }

// Caret-less <input> types that Enter does NOT reach natively: a checkbox/radio only toggles on
// Space, and range/color ignore Enter entirely. These are the only focusables in the app left
// without any activation path, so they get the synthetic click below.
const ENTER_INERT_INPUT_TYPES = ['checkbox', 'radio', 'range', 'color']

// Controls with no caret at all, where an arrow is never "move the cursor". They are reachable ONLY
// by the d-pad in Game mode, so swallowing their arrows would strand controller focus on a checkbox
// or a slider with no way back out — nav keeps all four. The tail already activates on Enter by
// itself (they behave like buttons), which is why it is excluded from the list above.
const CARETLESS_INPUT_TYPES = [...ENTER_INERT_INPUT_TYPES, 'button', 'submit', 'reset', 'file', 'image']

// Steppers: Up/Down change the value and Left/Right walk between segments, so all four are theirs.
const STEPPER_INPUT_TYPES = ['number', 'date', 'datetime-local', 'month', 'time', 'week']

/// Does the focused field claim this arrow for itself? Ownership is PER-KEY, not per-element: a
/// blanket "any input wins" guard also eats Up/Down, and Up/Down are the only keyboard way OUT of a
/// focused text box — that killed ArrowDown-from-the-search-field onto the first quick-search
/// result, and the same shape in the episode and downloads filters.
export function fieldOwnsArrow(field: FieldShape, key: ArrowKey): boolean {
  const vertical = key === 'ArrowUp' || key === 'ArrowDown'
  // A multi-line caret moves in both axes — Up/Down walk lines, so nav gets nothing.
  if (field.contentEditable || field.tag === 'TEXTAREA') return true
  // <select> cycles its value on all four arrows (Up/Down and Left/Right do the same thing), so the
  // horizontal pair is pure redundancy: handing it to nav leaves an escape route while keeping the
  // value adjustable by keyboard/d-pad — which matters because the native popup does not reliably
  // open from a synthetic click under gamescope, making the arrows the only way to change it there.
  // The selects that exist (batch quality/codec, picker sort/quality) sit in horizontal rows anyway.
  if (field.tag === 'SELECT') return vertical
  if (field.tag === 'INPUT') {
    // `.type` is normalised and lower-cased by the DOM, and an omitted/unknown type reads 'text'.
    const type = field.type ?? 'text'
    if (CARETLESS_INPUT_TYPES.includes(type)) return false
    if (STEPPER_INPUT_TYPES.includes(type)) return true
    // Single-line text-ish (text/search/password/url/email/tel): only the horizontal pair walks the
    // caret, and nav must not consume those — it preventDefaults, which froze the caret.
    return !vertical
  }
  // Role-only widgets: a combobox pops/cycles on Up/Down, a textbox/searchbox reads single-line.
  if (field.role === 'combobox') return vertical
  if (field.role === 'textbox' || field.role === 'searchbox') return !vertical
  return false
}

/// Enter reaches this control nowhere natively, so the handler has to synthesize the activation.
export const isEnterInertInput = (field: FieldShape) =>
  field.tag === 'INPUT' && ENTER_INERT_INPUT_TYPES.includes(field.type ?? 'text')

// The controller translator dispatches its arrows straight at `window`, so the target is often not
// an element at all — that case has no field and nav always wins.
const fieldShape = (target: EventTarget | null): FieldShape | null => {
  if (!(target instanceof HTMLElement)) return null
  return {
    tag: target.tagName,
    type: target instanceof HTMLInputElement ? target.type : undefined,
    contentEditable: target.isContentEditable,
    role: target.getAttribute('role') ?? undefined,
  }
}

export interface RevealAxisInput {
  itemStart: number
  itemEnd: number
  portStart: number
  portEnd: number
  startMargin: number
  endMargin: number
}

/** Keep focus inside a comfortable viewport band instead of waiting until it is already clipped.
 * Margins are clamped for oversized items, so this also behaves sensibly in compact modals. */
export function revealAxisDelta(input: RevealAxisInput): number {
  const itemSize = Math.max(0, input.itemEnd - input.itemStart)
  const portSize = Math.max(0, input.portEnd - input.portStart)
  const maxMargin = Math.max(0, (portSize - itemSize) / 2)
  const start = input.portStart + Math.min(Math.max(0, input.startMargin), maxMargin)
  const end = input.portEnd - Math.min(Math.max(0, input.endMargin), maxMargin)
  if (input.itemStart < start) return input.itemStart - start
  if (input.itemEnd > end) return input.itemEnd - end
  return 0
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const isNavigable = (el: HTMLElement) =>
  (el.checkVisibility?.() ?? true)
  && el.tabIndex >= 0
  && el.getAttribute('aria-hidden') !== 'true'
  && !(el instanceof HTMLButtonElement && el.disabled)

const focusables = (root: ParentNode) => {
  // Phone/desktop surfaces opt in deliberately. A television has no pointer fallback, so every
  // ordinary native control must be reachable even in touch-first components such as the Android
  // player and its settings sheet.
  const selector = get(isTv)
    ? '[data-focusable], button, a[href], input, textarea, select, [tabindex]'
    : '[data-focusable]'
  return [...root.querySelectorAll<HTMLElement>(selector)].filter(isNavigable)
}

export const containedInAxis = (itemStart: number, itemEnd: number, portStart: number, portEnd: number) =>
  itemStart >= portStart && itemEnd <= portEnd

/** Up/Down keeps the destination in the row's currently visible horizontal lane. A card that is
 * merely rendered somewhere in an overflow scroller is not a visible controller target. */
function visibleRowCandidates(root: HTMLElement): ElCand[] {
  const port = root.getBoundingClientRect()
  return focusables(root)
    .map((el) => ({ id: '', rect: el.getBoundingClientRect(), el }))
    .filter(({ rect }) => containedInAxis(rect.left, rect.right, port.left, port.right))
}

/**
 * Fast path for the Home/Browse surface in Game mode. A geometric search across the entire page
 * forces WebKitGTK to style and lay out every card before it can move the focus ring. Rows expose
 * their navigation boundary, so ordinary moves only inspect the current/adjacent row instead.
 *
 * `undefined` means this element is not in a scoped row and the generic page search should run.
 * `null` means the row fast path found no target (for example LEFT at the first card), so the
 * generic search may still cross into the sidebar.
 */
function pickInNavRows(active: HTMLElement, dir: Dir): HTMLElement | null | undefined {
  if (!get(gameMode) && !get(isTv) && !get(controllerMode)) return undefined
  const row = active.closest<HTMLElement>('[data-nav-row]')
  if (!row) return undefined

  const vertical = dir === 'up' || dir === 'down'
  const itemRoot = row.querySelector<HTMLElement>('[data-nav-row-items]') ?? row

  // Carousel/hero LEFT and RIGHT follow DOM order. No layout reads are needed for the other 19
  // posters in the row, and an offscreen neighbour remains reachable without a global search.
  if (!vertical) {
    const currentItems = focusables(itemRoot)
    const index = currentItems.indexOf(active)
    if (index >= 0) return currentItems[index + (dir === 'right' ? 1 : -1)] ?? null
  }

  const cur = active.getBoundingClientRect()
  // A header action such as View more can still move down into its own posters. Normal card
  // movement skips even querying this list, avoiding visibility/layout work for the current row.
  if (!itemRoot.contains(active)) {
    const samePick = pickInDirection(cur, visibleRowCandidates(itemRoot), dir, /* cone */ false)
    if (samePick) return samePick.el
  }
  if (!vertical) return null

  const rows = [...document.querySelectorAll<HTMLElement>('[data-nav-row]')]
    .filter((candidate) => candidate.checkVisibility?.() ?? true)
  const rowIndex = rows.indexOf(row)
  if (rowIndex < 0) return null
  const step = dir === 'down' ? 1 : -1
  const targetRow = rows[rowIndex + step]
  if (!targetRow) return null
  const preferred = targetRow.querySelector<HTMLElement>('[data-nav-row-default][data-focusable]')
  if (preferred && isNavigable(preferred)) return preferred
  const targetRoot = targetRow.querySelector<HTMLElement>('[data-nav-row-items]') ?? targetRow
  // Row order already establishes the intended direction, so do not reject a target merely
  // because the adjacent row has a different card width or horizontal scroll position. Do reject
  // cards clipped to the left/right: vertical reveal intentionally scrolls only the page axis.
  const pick = pickInDirection(cur, visibleRowCandidates(targetRoot), dir, /* cone */ false)
  if (pick) return pick.el

  // Skeleton rows have no card focusables yet. Retain the current focus while data arrives instead
  // of skipping across multiple placeholders and selecting something outside the viewport.
  return active
}

type RevealScrollTarget = Window | HTMLElement
const controllerScrollUntil = new WeakMap<object, number>()
const CONTROLLER_SMOOTH_WINDOW_MS = 600

/** WebKitGTK versions shipped by SteamOS can retain the old destination when one smooth scroll
 * interrupts another. Stop at the interpolated position before starting the replacement, so
 * rapid Down taps cannot later rebound toward an older focused row. `instant` also ignores the
 * document's global smooth-scroll CSS. */
function abortOngoingScroll(target: RevealScrollTarget): void {
  if (target instanceof HTMLElement) {
    target.scrollTo({ left: target.scrollLeft, top: target.scrollTop, behavior: 'instant' })
  } else {
    window.scrollTo({ left: window.scrollX, top: window.scrollY, behavior: 'instant' })
  }
}

function runControllerScroll(
  target: RevealScrollTarget,
  behavior: ScrollBehavior,
  request: () => void,
): void {
  const now = performance.now()
  if ((controllerScrollUntil.get(target) ?? 0) > now) abortOngoingScroll(target)
  request()
  if (behavior === 'smooth') controllerScrollUntil.set(target, now + CONTROLLER_SMOOTH_WINDOW_MS)
  else controllerScrollUntil.delete(target)
}

/** Reveal controller focus without asking scrollIntoView to move every scrollable ancestor. The
 * settings category rail owns its own viewport; moving it must never scroll the category content. */
function revealFocused(el: HTMLElement, vertical: boolean, rapid = false): void {
  // A single D-pad press should visibly carry the selected card with it. Held-key repeats switch
  // to instant movement so WebKitGTK never queues several smooth animations behind the thumb.
  const reduced = document.documentElement.dataset.motion === 'reduced'
    || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const behavior: ScrollBehavior = rapid || reduced ? 'auto' : 'smooth'
  // The featured carousel is taller than the safe-band math can infer from its bottom action row.
  // Entering its primary action means reveal the whole feature, not just the focused button.
  if (vertical && el.hasAttribute('data-nav-scroll-top')) {
    runControllerScroll(window, behavior, () => window.scrollTo({ top: 0, behavior }))
    return
  }
  // Horizontal carousel navigation owns only that row. Vertical navigation still reveals the
  // destination on the page, rather than trying to scroll the destination row inside itself.
  const pane = vertical
    ? el.closest<HTMLElement>('[data-nav-scroll-container]')
    : el.closest<HTMLElement>('[data-carousel-scroller], [data-nav-scroll-container]')
  const item = el.getBoundingClientRect()
  const port = pane?.getBoundingClientRect() ?? {
    top: 0,
    left: 0,
    bottom: window.innerHeight,
    right: window.innerWidth,
  }
  const portHeight = Math.max(0, port.bottom - port.top)
  const portWidth = Math.max(0, port.right - port.left)
  // Keep extra space in the direction of travel. This makes the NEXT row/card visible and prevents
  // controller focus from slowly riding the bottom/right edge until it disappears from view.
  const top = revealAxisDelta({
    itemStart: item.top,
    itemEnd: item.bottom,
    portStart: port.top,
    portEnd: port.bottom,
    startMargin: clamp(portHeight * 0.12, 40, 96),
    endMargin: clamp(portHeight * 0.2, 64, 144),
  })
  const left = revealAxisDelta({
    itemStart: item.left,
    itemEnd: item.right,
    portStart: port.left,
    portEnd: port.right,
    startMargin: clamp(portWidth * 0.08, 24, 96),
    endMargin: clamp(portWidth * 0.18, 48, 176),
  })
  if (!top && !left) return
  const target: RevealScrollTarget = pane ?? window
  runControllerScroll(target, behavior, () => {
    target.scrollBy({ top: vertical ? top : 0, left: vertical ? 0 : left, behavior })
  })
}

export function initDpadNav() {
  window.addEventListener('keydown', (e) => {
    // Only the four arrows are bound — Home/End/PageUp are never mapped, so a focused field keeps
    // its native line-start/line-end behaviour without needing to be excused from anything.
    const map: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
    const dir = map[e.key]
    const field = dir ? fieldShape(e.target) : null
    if (field && fieldOwnsArrow(field, e.key as ArrowKey)) return
    // Resolve the active modal before the blanket player gate. Change source is deliberately
    // opened while playback continues, and its focus trap must still own the arrows.
    const trap = document.querySelector('[aria-label="On-screen keyboard"][data-nav-trap]')
      ?? document.querySelector('[data-nav-trap]')
    // During playback the player owns the arrow/Enter keys (seek/skip/pause). Spatial focus nav
    // must stay OUT of the way — otherwise a desktop arrow both seeks AND moves focus onto the
    // player controls / across to the sidebar (which then expands over the video).
    if (get(playing) && !trap) {
      if (dir) e.preventDefault()
      return
    }
    if (!dir) {
      // The broad Enter→click is gone: every other focusable either activates natively (button/a/
      // summary/input type=button) or runs its own Enter keydown (the role="button" cards, the
      // source rows), so the synthetic click fired those a second time. What it DID uniquely carry
      // is the caret-less inputs — Enter on a checkbox does nothing natively, only Space toggles —
      // so that one path stays, narrowed to exactly those. preventDefault keeps it from also
      // triggering an implicit form submit. The controller's A button clicks `document.activeElement`
      // directly and never synthesizes Enter (see nav/gamepad.ts), so Game mode is unaffected.
      if (e.key !== 'Enter') return
      const active = document.activeElement
      const shape = fieldShape(active)
      if (shape && isEnterInertInput(shape)) {
        (active as HTMLElement).click()
        e.preventDefault()
      }
      return
    }
    // Focus trap: while a modal marks itself `data-nav-trap` (e.g. the exit prompt), confine
    // navigation to its focusables so the d-pad/stick can't wander onto the browse behind it.
    // The built-in Deck keyboard can sit above another modal. Prefer its trap while it is
    // visible; otherwise arrow navigation would continue moving through the dialog underneath.
    const root: ParentNode = trap ?? document
    const active = document.activeElement as HTMLElement
    const vertical = dir === 'up' || dir === 'down'
    // No real focus yet (just opened / focus sits on <body>): the FIRST press must land on the
    // first content focusable — NOT spatial-search from <body>'s full-page rect, which measures
    // "down" from the whole viewport and flings focus deep into the grid (the "jumps to romance,
    // 3rd card" bug). Prefer the first non-sidebar focusable (the hero button) so the row is next.
    if (!active?.closest?.('[data-focusable]') || (trap && !trap.contains(active))) {
      const els = focusables(root)
      const content = els.filter(el => !el.closest('[data-nav-sidebar]'))
      // Prefer the first content focusable that ISN'T a text box (so entering Downloads/Search
      // doesn't auto-focus the filter/search field and trap the arrows in the on-screen keyboard).
      const first = content.find(el => !isTextInput(el)) ?? content[0] ?? els[0]
      if (first) {
        first.focus({ preventScroll: true })
        revealFocused(first, vertical, e.repeat)
        e.preventDefault()
      }
      return
    }
    // Some transitions have semantic row order that geometry cannot infer. The schedule weekday
    // strip spans the whole screen; from a weekday near the right edge, a 45-degree cone rejects
    // the first airing row and finds a farther card below it. A named override keeps ordinary
    // spatial navigation everywhere else while letting that strip hand Down to the first airing.
    const explicitName = active.getAttribute(`data-nav-${dir}`)
    const explicit = explicitName
      ? [...root.querySelectorAll<HTMLElement>('[data-nav-id]')]
        .find((el) => el !== active && el.getAttribute('data-nav-id') === explicitName && isNavigable(el))
      : undefined
    if (explicit) {
      explicit.focus({ preventScroll: true })
      revealFocused(explicit, vertical, e.repeat)
      e.preventDefault()
      return
    }
    // Home/Browse rows have enough semantic structure to avoid a whole-page geometry pass. This
    // runs after named overrides (schedule/detail contracts still win) and before the generic
    // fallback used by irregular grids, settings, and sidebar crossings.
    const rowPick = pickInNavRows(active, dir)
    if (rowPick) {
      rowPick.focus({ preventScroll: true })
      revealFocused(rowPick, vertical, e.repeat)
      e.preventDefault()
      return
    }
    const els = focusables(root)
    const cur = active.getBoundingClientRect()
    if (!cur) return
    // The sidebar is a separate nav region (a fixed left rail). Movement stays INSIDE the
    // current region first; only when there's nothing that way in-region do we cross to the
    // other region. Up/down never crosses (rows never jump to the sidebar, and vice-versa);
    // left/right crosses at a row's edge — WITHOUT the alignment cone, so a low row can still
    // reach a sidebar link that sits well above it (the "fantasy row can't reach the menu" bug).
    const inSidebar = (el: Element | null) => !!el?.closest('[data-nav-sidebar]')
    const activeInSidebar = inSidebar(active)
    const all: ElCand[] = els.filter(el => el !== active).map(el => ({ id: '', rect: el.getBoundingClientRect(), el }))
    const sameRegion = all.filter(c => inSidebar(c.el) === activeInSidebar)
    let pick = pickInDirection(cur, sameRegion, dir)
    if (!pick) {
      if (vertical) {
        // Nothing straight down/up in-region: drop the alignment cone (still same-region) so a
        // centred bottom-row card can reach the pagination row's Prev/Next sitting off to the sides
        // below it — the ×4 off-axis weighting still prefers the nearest one — instead of the press
        // doing nothing and forcing a LEFT/RIGHT detour.
        pick = pickInDirection(cur, sameRegion, dir, /* cone */ false)
      } else {
        const otherRegion = all.filter(c => inSidebar(c.el) !== activeInSidebar)
        pick = pickInDirection(cur, otherRegion, dir, /* cone */ false)
      }
    }
    if (pick?.el) {
      // Focus WITHOUT the browser's instant jump-scroll, then smooth-scroll ONLY along the axis
      // we moved: horizontal moves scroll the row horizontally (block:nearest avoids a vertical
      // re-center jitter on every left/right); vertical moves scroll the page vertically.
      pick.el.focus({ preventScroll: true })
      revealFocused(pick.el, vertical, e.repeat)
      e.preventDefault()
    }
  })
}
