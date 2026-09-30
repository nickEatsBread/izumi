import { get } from 'svelte/store'
import { gameMode, playing } from '$lib/player/session'
import { isTv } from '$lib/platform'
import { controllerMode } from './input'
import { pickInDirection, type Dir } from './spatial'
import { activeNavTrap, visibleNavTraps } from './traps'
import { takeFocusHint } from './focus-hint'
import { isNavigable, isRovingTab } from './focusable'
import { isPadEvent, padAdjust } from './pad-controls'
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
// `rovingTab`: a role="tab" in a roving-tabindex tablist (focusable.ts `isRovingTab`).
export interface FieldShape { tag: string; type?: string; contentEditable?: boolean; role?: string; rovingTab?: boolean }

// Caret-less <input> types that Enter does NOT reach natively: a checkbox/radio only toggles on
// Space, and range/color ignore Enter entirely. These are the only focusables in the app left
// without any activation path, so they get the synthetic click below.
const ENTER_INERT_INPUT_TYPES = ['checkbox', 'radio', 'range', 'color']

// Controls with no caret at all, where an arrow is never "move the cursor". Swallowing their arrows
// would strand keyboard focus on a checkbox with no way back out, so nav keeps all four. A slider is
// the one exception: under a keyboard off TV it keeps the horizontal pair for its native step
// (`rangeOwnsHorizontal`) while Up/Down still leave; pad arrows skip field ownership altogether and
// reach sliders through `padAdjust` instead. The tail already activates on Enter by itself (they
// behave like buttons), which is why it is excluded from the list above.
const CARETLESS_INPUT_TYPES = [...ENTER_INERT_INPUT_TYPES, 'button', 'submit', 'reset', 'file', 'image']

// Steppers: Up/Down change the value and Left/Right walk between segments, so all four are theirs.
const STEPPER_INPUT_TYPES = ['number', 'date', 'datetime-local', 'month', 'time', 'week']

/** Caller context for `fieldOwnsArrow`, kept out of the shape so the rules stay a pure function. */
export interface FieldArrowOptions {
  /** A keyboard-focused slider steps with Left/Right (web standard, owner decision 2). The nav
   *  handler passes `!get(isTv)`: a TV remote keeps Left/Right as focus moves (spec §3.11). */
  rangeOwnsHorizontal?: boolean
}

/// Does the focused field claim this arrow for itself? Ownership is PER-KEY, not per-element: a
/// blanket "any input wins" guard also eats Up/Down, and Up/Down are the only keyboard way OUT of a
/// focused text box — that killed ArrowDown-from-the-search-field onto the first quick-search
/// result, and the same shape in the episode and downloads filters.
export function fieldOwnsArrow(field: FieldShape, key: ArrowKey, options: FieldArrowOptions = {}): boolean {
  const vertical = key === 'ArrowUp' || key === 'ArrowDown'
  // A roving tab (the tablist keeps one tab stop and parks the rest at tabindex -1, like Sources)
  // runs its own Left/Right: the page's handler steps once and nav stands down instead of stepping
  // a second time. Up/Down are not the strip's, so they still leave it.
  if (field.rovingTab) return !vertical
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
    // A keyboard slider steps natively with Left/Right; Up/Down stay nav's, so it never traps.
    if (type === 'range' && options.rangeOwnsHorizontal) return !vertical
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
    rovingTab: isRovingTab(target),
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

/** The nav region holding `el`: the app's side or top bar (`[data-nav-sidebar]`) or a
 *  `[data-nav-region]` (the Settings category rail, Theme Studio). null means page content.
 *  Vertical moves never leave a region; horizontal moves cross into another one without the
 *  alignment cone and land on its `[data-nav-region-default]` when it has one. */
export function regionOf(el: Element | null): HTMLElement | null {
  return el?.closest<HTMLElement>('[data-nav-sidebar], [data-nav-region]') ?? null
}

// The [data-nav-region] that focus, or a tap, was last in. A tap on a Settings rail link leaves
// focus on <body> once the route changes (SvelteKit's navigation focus reset, or a blur); the
// first d-pad press then returns to the rail's current category instead of the rail's first
// control (Search). The app sidebar is not tracked, so leaving it keeps the content-first landing.
let lastRegion: HTMLElement | null = null
const REGION_TRACKER = Symbol.for('izumi.navRegionTracker')

/** One focusin + pointerdown listener pair per window; a re-init (HMR) replaces the previous pair. */
function trackRegionFocus(): void {
  const scope = globalThis as unknown as Record<symbol, ((event: Event) => void) | undefined>
  const previous = scope[REGION_TRACKER]
  if (previous) {
    document.removeEventListener('focusin', previous, true)
    window.removeEventListener('pointerdown', previous, true)
  }
  const track = (event: Event) => {
    // <body> taking focus is "nothing focused", not a new place. SvelteKit focuses it through a
    // temporary tabindex after every navigation without keepFocus (a rail tap included), and that
    // focusin must not forget the region the tap came from. A tap on the page still clears it.
    if (event.type === 'focusin' && (event.target === document.body || event.target === document.documentElement)) return
    lastRegion = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-nav-region]') : null
  }
  scope[REGION_TRACKER] = track
  document.addEventListener('focusin', track, true)
  window.addEventListener('pointerdown', track, true)
}

/** Body fallback step 3: the default item of the region focus came from, while it is still there. */
function regionReturnTarget(root: ParentNode): HTMLElement | null {
  const region = lastRegion
  if (!region?.isConnected || !(root as Node).contains(region)) return null
  const target = region.querySelector<HTMLElement>('[data-nav-region-default]')
  return target && isNavigable(target) ? target : null
}

const focusables = (root: ParentNode) => {
  // Phone/desktop surfaces opt in deliberately. A television has no pointer fallback, so every
  // ordinary native control must be reachable even in touch-first components such as the Android
  // player and its settings sheet.
  const selector = get(isTv)
    ? '[data-focusable], button, a[href], input, textarea, select, [tabindex]'
    : '[data-focusable]'
  return [...root.querySelectorAll<HTMLElement>(selector)].filter(isNavigable)
}

/** Entering a roving tablist from outside it lands on the selected tab (the WAI-ARIA tabs pattern),
 *  not on whichever inactive tab happens to sit nearest; moves within the strip keep the geometric
 *  pick. `from` is the element focus is leaving. */
function rovingEntry(pick: HTMLElement, from: Element | null): HTMLElement {
  if (pick.getAttribute('aria-selected') === 'true' || !isRovingTab(pick)) return pick
  const list = pick.closest('[role="tablist"]')
  if (!list || (from && list.contains(from))) return pick
  const selected = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
  return selected && isNavigable(selected) ? selected : pick
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
  const wrapping = row.hasAttribute('data-nav-row-wrap')

  // Carousel/hero LEFT and RIGHT follow DOM order. No layout reads are needed for the other 19
  // posters in the row, and an offscreen neighbour remains reachable without a global search.
  // A wrapping grid row instead keeps the generic search's geometric semantics (scoped below):
  // DOM order would wrap a line-start press onto the previous line's far end.
  if (!vertical && !wrapping) {
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
  // Wrapping grid rows paint several lines inside one section. Section-stepping would jump straight
  // past the lines below the focused card, so run the generic search's geometry over just this row's
  // own cards — far cheaper than the page-wide pass — and fall through at the grid's edge, where the
  // press should carry on to the adjacent row (vertical) or cross regions (horizontal).
  if (wrapping && itemRoot.contains(active)) {
    const within = pickInDirection(cur, visibleRowCandidates(itemRoot), dir)
    if (within) return within.el
  }
  if (!vertical) return null

  // An inert row (the Edit Home previews) has no reachable card, so stepping onto it would strand
  // focus on the `return active` below. Skip it like a hidden row.
  const rows = [...document.querySelectorAll<HTMLElement>('[data-nav-row]')]
    .filter((candidate) => (candidate.checkVisibility?.() ?? true) && !candidate.closest('[inert]'))
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

/**
 * Fast path for Up/Down inside the side rail. The rail is a single column, so DOM order is its
 * visual order: walking it needs no geometry, and moving through the menu never makes WebKitGTK
 * style and lay out every card on the page behind it. A top bar is a row and keeps the spatial
 * search, as does an open picker's `data-nav-trap` (the caller skips this path under a trap).
 *
 * `undefined` means this is not a move within the rail; `null` means the rail ends there.
 */
function pickInSidebar(active: HTMLElement, dir: Dir): HTMLElement | null | undefined {
  if (dir !== 'up' && dir !== 'down') return undefined
  const rail = active.closest<HTMLElement>('[data-nav-sidebar][data-slot="nav.side"]')
  if (!rail) return undefined
  const items = focusables(rail)
  const index = items.indexOf(active)
  if (index < 0) return undefined
  return items[index + (dir === 'down' ? 1 : -1)] ?? null
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

/** The position:fixed layer holding `el` (a dialog, the on-screen keyboard), or null when `el`
 * moves with the page. */
function fixedLayerOf(el: HTMLElement): HTMLElement | null {
  for (let node: HTMLElement | null = el; node && node !== document.documentElement; node = node.parentElement) {
    if (getComputedStyle(node).position === 'fixed') return node
  }
  return null
}

/** The nearest ancestor of `el`, up to and including its fixed `layer`, that scrolls along the axis
 * of travel: a dialog's own list or body. */
function scrollPortWithin(el: HTMLElement, layer: HTMLElement, vertical: boolean): HTMLElement | null {
  if (el === layer) return null
  for (let node = el.parentElement; node; node = node.parentElement) {
    const overflow = vertical ? getComputedStyle(node).overflowY : getComputedStyle(node).overflowX
    const overflowing = vertical ? node.scrollHeight > node.clientHeight : node.scrollWidth > node.clientWidth
    if ((overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') && overflowing) return node
    if (node === layer) return null
  }
  return null
}

/** Pure. One dead-end scroll step along `direction` (1 = down): 40% of the port, clamped so the
 *  focused item never leaves it (down: its top stays at or below the port's top; up: its bottom
 *  stays at or above the port's bottom) and to the `room` the scroller has left that way
 *  (unlimited when omitted). 0 means there is nothing to do. */
export function deadEndScrollDelta(input: {
  itemStart: number
  itemEnd: number
  portStart: number
  portEnd: number
  direction: 1 | -1
  room?: number
}): number {
  const step = Math.round(Math.max(0, input.portEnd - input.portStart) * 0.4)
  const clearance = input.direction > 0 ? input.itemStart - input.portStart : input.portEnd - input.itemEnd
  const distance = Math.max(0, Math.min(step, clearance, input.room ?? Infinity))
  return distance && input.direction < 0 ? -distance : distance
}

/** How far `pane`, or the window when null, can still scroll along `direction`. Under a pixel is
 *  none (a fractional scrollTop at the end). The window's room comes from the document's own box,
 *  in the same viewport px as the rects it is compared with. */
function scrollRoom(pane: HTMLElement | null, direction: 1 | -1): number {
  let room: number
  if (pane) {
    room = direction > 0 ? pane.scrollHeight - pane.clientHeight - pane.scrollTop : pane.scrollTop
  } else {
    const doc = document.documentElement.getBoundingClientRect()
    room = direction > 0 ? doc.bottom - window.innerHeight : -doc.top
  }
  return room >= 1 ? room : 0
}

/** Controller Up/Down found nothing further. Inside a settings-style page (`[data-nav-surface]`)
 *  or an open <dialog>, scroll its text along instead of doing nothing (a changelog, a licence, the
 *  end of a page), never so far that the focused control leaves the view. A modal layer (a native
 *  <dialog>, or a position:fixed overlay such as the add-on configurator, which a settings page
 *  renders inline) is fixed to the viewport: a window scroll would only move the page underneath
 *  it, as revealFocused already knows. There only a scroller inside the layer moves, or nothing.
 *  Returns false, so the press is not consumed, when nothing can move that way. `rapid` (a held
 *  button's repeats) steps instantly, as revealFocused does: each repeat would otherwise abort the
 *  previous smooth step at its interpolated position, a stuttering crawl on WebKitGTK. */
function deadEndScroll(active: HTMLElement, dir: Dir, rapid = false): boolean {
  const dialog = active.closest<HTMLElement>('dialog[open]')
  if (!dialog && !active.closest('[data-nav-surface]')) return false
  const layer = dialog ?? fixedLayerOf(active)
  const direction = dir === 'down' ? 1 : -1
  let pane = active.closest<HTMLElement>('[data-nav-scroll-container]')
  // A marked scroller outside the modal layer belongs to the page behind the modal.
  if (pane && layer && !layer.contains(pane)) pane = null
  if (!pane && layer) {
    pane = scrollPortWithin(active, layer, true) ?? dialog
    if (!pane) return false
  }
  // A page scroller with nothing left to give that way (at its end, or not overflowing at all,
  // like the capped extensions list uncapped on a phone) hands the step to the window, so the text
  // below it stays reachable. Inside a modal layer the window would move only the page behind it.
  let room = scrollRoom(pane, direction)
  if (!room && pane && !layer) {
    pane = null
    room = scrollRoom(null, direction)
  }
  if (!room) return false
  const item = active.getBoundingClientRect()
  // The window's port leaves out the fixed chrome over the page: the desktop titlebar on top and
  // a theme's button-hint bar at the bottom (the same band revealFocused keeps at its start).
  const inset = clamp(window.innerHeight * 0.12, 40, 96)
  const port = pane?.getBoundingClientRect() ?? { top: inset, bottom: window.innerHeight - inset }
  const delta = deadEndScrollDelta({
    itemStart: item.top,
    itemEnd: item.bottom,
    portStart: port.top,
    portEnd: port.bottom,
    direction,
    room,
  })
  if (!delta) return false
  const reduced = document.documentElement.dataset.motion === 'reduced'
    || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const behavior: ScrollBehavior = rapid || reduced ? 'auto' : 'smooth'
  const target: RevealScrollTarget = pane ?? window
  runControllerScroll(target, behavior, () => target.scrollBy({ top: delta, behavior }))
  return true
}

/** Reveal controller focus without asking scrollIntoView to move every scrollable ancestor. The
 * settings category rail owns its own viewport; moving it must never scroll the category content. */
function revealFocused(el: HTMLElement, vertical: boolean, rapid = false): void {
  // The navigation shell is fixed to the viewport, so every row of it is always on screen. Scrolling
  // the page cannot bring one into view; it only dragged the page underneath the menu on each press.
  if (el.closest('[data-nav-sidebar]')) return
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
  let pane = vertical
    ? el.closest<HTMLElement>('[data-nav-scroll-container]')
    : el.closest<HTMLElement>('[data-carousel-scroller], [data-nav-scroll-x], [data-nav-scroll-container]')
  // A dialog or the on-screen keyboard is fixed to the viewport, so scrolling the window cannot
  // reveal its controls. It only moved the page underneath (and a popover that follows its anchor
  // on scroll). Reveal within the dialog's own scrolling body, or leave everything where it is. A
  // menu that sits in the page is not fixed and still reveals through the window.
  if (!pane && el.closest('[data-nav-trap]')) {
    const layer = fixedLayerOf(el)
    if (layer) {
      pane = scrollPortWithin(el, layer, vertical)
      if (!pane) return
    }
  }
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
  // A capped list inside the page (data-nav-scroll-container="nested": the extensions package
  // list) moves only its own content. When the list itself runs below the fold, or is not capped
  // at all on a phone, the window also brings the item's post-scroll position into view.
  if (vertical && pane?.dataset.navScrollContainer === 'nested') {
    const paneShift = clamp(top, -pane.scrollTop, Math.max(0, pane.scrollHeight - pane.clientHeight - pane.scrollTop))
    const windowTop = revealAxisDelta({
      itemStart: item.top - paneShift,
      itemEnd: item.bottom - paneShift,
      portStart: 0,
      portEnd: window.innerHeight,
      startMargin: clamp(window.innerHeight * 0.12, 40, 96),
      endMargin: clamp(window.innerHeight * 0.2, 64, 144),
    })
    if (windowTop) runControllerScroll(window, behavior, () => window.scrollBy({ top: windowTop, behavior }))
  }
  if (!top && !left) return
  const target: RevealScrollTarget = pane ?? window
  runControllerScroll(target, behavior, () => {
    target.scrollBy({ top: vertical ? top : 0, left: vertical ? 0 : left, behavior })
  })
}

/** Reveal a region's default item (the Settings rail's current category) when a press lands on it.
 *  A sideways press reveals only the horizontal axis, but the default can sit below its region's
 *  fold: on the Deck the rail holds about 20 links in a ~600 px port, and nothing scrolls it to the
 *  current category on a route load. So a sideways entry also reveals the item vertically, inside
 *  the region's own [data-nav-scroll-container] only. Never the window: that would scroll the
 *  category content, or the page under a floating panel. The vertical pass runs second, so its
 *  smooth scroll is the one that survives when both passes move the same pane. */
function revealRegionEntry(el: HTMLElement, vertical: boolean, rapid: boolean): void {
  revealFocused(el, vertical, rapid)
  if (vertical) return
  const region = regionOf(el)
  const pane = el.closest<HTMLElement>('[data-nav-scroll-container]')
  if (region && pane && region.contains(pane)) revealFocused(el, true, rapid)
}

/** The pane that can lift `field` above a docked keyboard: a `[data-nav-scroll-container]`; else,
 *  inside a fixed layer (a dialog, a sheet), its nearest ancestor styled to scroll, whether or not it
 *  overflows yet (the caller pads it to make room). null = page content: the window scrolls.
 *  undefined = a fixed layer with nothing that scrolls, where no scroll can move the field. */
function keyboardRevealPane(field: HTMLElement): HTMLElement | null | undefined {
  const container = field.closest<HTMLElement>('[data-nav-scroll-container]')
  if (container) return container
  const layer = fixedLayerOf(field)
  if (!layer) return null
  for (let node = field.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY
    if (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') return node
    if (node === layer) break
  }
  return undefined
}

const KEYBOARD_GAP = 16

/** Scroll `field` so its bottom edge sits KEYBOARD_GAP px above a panel docked at `keyboardTop`
 *  (viewport px; the on-screen keyboard's top edge). Moves the field's own pane, or the window for
 *  page content, and never pushes the field's top out of that pane. When the pane cannot scroll far
 *  enough, a temporary bottom padding makes the room. Returns the undo for that padding (a no-op
 *  when none was added); the keyboard view calls it when it closes. */
export function revealAboveKeyboard(field: HTMLElement, keyboardTop: number): () => void {
  const item = field.getBoundingClientRect()
  const overlap = item.bottom + KEYBOARD_GAP - keyboardTop
  if (overlap <= 0) return () => {}
  const pane = keyboardRevealPane(field)
  if (pane === undefined) return () => {}
  const paneTop = pane ? pane.getBoundingClientRect().top : 0
  const delta = Math.min(overlap, item.top - paneTop - KEYBOARD_GAP)
  if (delta <= 0) return () => {}
  const room = pane
    ? pane.scrollHeight - pane.clientHeight - pane.scrollTop
    : document.documentElement.scrollHeight - window.innerHeight - window.scrollY
  const padded = pane ?? document.body
  const previousPadding = padded.style.paddingBottom
  if (room < delta) {
    const current = Number.parseFloat(getComputedStyle(padded).paddingBottom) || 0
    padded.style.paddingBottom = `${current + delta - room}px`
  }
  const scroller: RevealScrollTarget = pane ?? window
  scroller.scrollBy({ top: delta, left: 0, behavior: 'auto' })
  return room < delta ? () => { padded.style.paddingBottom = previousPadding } : () => {}
}

/** Where a focus fallback may land: the active trap, unless that is the closing on-screen keyboard
 *  (its root is still in the DOM for one flush), then the first other visible trap, else the page. */
function fallbackScope(): ParentNode {
  const trap = activeNavTrap()
  if (trap && !trap.closest('[data-osk]')) return trap
  return visibleNavTraps().find((candidate) => !candidate.closest('[data-osk]')) ?? document
}

/** Focus the navigable control whose centre is nearest `rect`'s centre, inside `root` (default:
 *  fallbackScope()). For when the element that held focus is gone: the on-screen keyboard's field
 *  removed, hidden or made inert under it. Never picks a keyboard key. Returns the focused element,
 *  or null when nothing is navigable. */
export function focusNearestFocusable(
  rect: { left: number; top: number; width: number; height: number },
  root?: ParentNode,
): HTMLElement | null {
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2
  let best: HTMLElement | null = null
  let bestDistance = Infinity
  for (const el of focusables(root ?? fallbackScope())) {
    if (el.closest('[data-osk]')) continue
    const box = el.getBoundingClientRect()
    const distance = Math.hypot(box.left + box.width / 2 - x, box.top + box.height / 2 - y)
    if (distance < bestDistance) {
      best = el
      bestDistance = distance
    }
  }
  best?.focus({ preventScroll: true })
  return best
}

// The live keydown handler is kept on a registered symbol on globalThis. A second initDpadNav()
// (Vite HMR re-running the app layout, or a duplicate copy of this module) then replaces the first
// handler instead of stacking another one that moves focus twice per press.
const NAV_KEYDOWN = Symbol.for('izumi.navKeydown')
type NavKeydownHost = Record<symbol, ((e: KeyboardEvent) => void) | undefined>

export function initDpadNav() {
  trackRegionFocus()
  const host = globalThis as unknown as NavKeydownHost
  const previous = host[NAV_KEYDOWN]
  if (previous) window.removeEventListener('keydown', previous)
  const onKeydown = (e: KeyboardEvent) => {
    // Only the four arrows are bound — Home/End/PageUp are never mapped, so a focused field keeps
    // its native line-start/line-end behaviour without needing to be excused from anything.
    const map: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
    const dir = map[e.key]
    // Pad arrows always navigate (owner decision 3): a field the d-pad lands on never keeps them.
    // Only a real keyboard's arrows are the field's own to walk its caret or cycle its value.
    const field = dir && !isPadEvent(e) ? fieldShape(e.target) : null
    if (field && fieldOwnsArrow(field, e.key as ArrowKey, { rangeOwnsHorizontal: !get(isTv) })) return
    // Resolve the active modal before the blanket player gate. Change source is deliberately
    // opened while playback continues, and its focus trap must still own the arrows. One resolver
    // decides which trap owns the pad: the open keyboard, the top nav layer, a modal <dialog>, then
    // the first visible legacy trap (nav/traps.ts).
    const trap = activeNavTrap()
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
      // A layer closed by touch or the mouse left its opener as a hint instead of moving focus
      // (nav/overlay.ts): the first d-pad press lands back on it, not on the page's first control.
      const hinted = takeFocusHint(root)
      if (hinted?.closest('[data-focusable]') && isNavigable(hinted)) {
        hinted.focus({ preventScroll: true })
        revealFocused(hinted, vertical, e.repeat)
        e.preventDefault()
        return
      }
      // Step 3: focus left a region (a tap on a Settings rail link, whose route change blurs it):
      // go back to that region's current item rather than to whatever comes first.
      const regionDefault = regionReturnTarget(root)
      if (regionDefault) {
        regionDefault.focus({ preventScroll: true })
        revealRegionEntry(regionDefault, vertical, e.repeat)
        e.preventDefault()
        return
      }
      const els = focusables(root)
      // Content first: a region (the app sidebar, the Settings rail with its Search button, Theme
      // Studio) is only entered deliberately. Inside a trap, "content" is the trap's own region.
      const rootRegion = root instanceof Element ? regionOf(root) : null
      const content = els.filter(el => regionOf(el) === rootRegion)
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
    // A focused slider takes the pad's Left/Right as steps; TV keeps them as focus moves (spec
    // §3.11). This sits after the landing block, so it only acts on a slider that already holds
    // focus, and before the named overrides, so a data-nav-left/right can never pre-empt stepping.
    if (isPadEvent(e) && !get(isTv) && padAdjust(active, dir, e.repeat)) {
      e.preventDefault()
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
      const target = rovingEntry(explicit, active)
      target.focus({ preventScroll: true })
      revealFocused(target, vertical, e.repeat)
      e.preventDefault()
      return
    }
    // Home/Browse rows have enough semantic structure to avoid a whole-page geometry pass. This
    // runs after named overrides (schedule/detail contracts still win) and before the generic
    // fallback used by irregular grids, settings, and sidebar crossings.
    const rowPick = pickInNavRows(active, dir)
    if (rowPick) {
      const target = rovingEntry(rowPick, active)
      target.focus({ preventScroll: true })
      revealFocused(target, vertical, e.repeat)
      e.preventDefault()
      return
    }
    // Up/Down within the side rail. At either end nothing moves, as with the spatial search, which
    // never crosses regions vertically.
    const railPick = trap ? undefined : pickInSidebar(active, dir)
    if (railPick !== undefined) {
      if (railPick) {
        railPick.focus({ preventScroll: true })
        e.preventDefault()
      }
      return
    }
    const els = focusables(root)
    const cur = active.getBoundingClientRect()
    if (!cur) return
    // Regions (regionOf): the app sidebar or top bar and every [data-nav-region] (the Settings
    // category rail, Theme Studio) are separate from the page content and from each other.
    // Movement stays INSIDE the current region first. Up/down never crosses (the end of a settings
    // page never drops into the rail, rows never jump to the sidebar); left/right crosses at an
    // edge WITHOUT the alignment cone, so a low row can still reach a sidebar link that sits well
    // above it (the "fantasy row can't reach the menu" bug), and lands on the entered region's
    // default item when it has one.
    const activeRegion = regionOf(active)
    const all: ElCand[] = els.filter(el => el !== active).map(el => ({ id: '', rect: el.getBoundingClientRect(), el }))
    const sameRegion = all.filter(c => regionOf(c.el) === activeRegion)
    let pick = pickInDirection(cur, sameRegion, dir)
    let entersRegionDefault = false
    if (!pick) {
      if (vertical) {
        // Nothing straight down/up in-region: drop the alignment cone (still same-region) so a
        // centred bottom-row card can reach the pagination row's Prev/Next sitting off to the sides
        // below it — the ×4 off-axis weighting still prefers the nearest one — instead of the press
        // doing nothing and forcing a LEFT/RIGHT detour.
        pick = pickInDirection(cur, sameRegion, dir, /* cone */ false)
        // A true dead end. A controller has no other way to scroll a text-only stretch (a
        // changelog, a licence, the end of a settings page), so scroll it along instead.
        if (!pick && isPadEvent(e) && !get(isTv) && deadEndScroll(active, dir, e.repeat)) {
          e.preventDefault()
          return
        }
      } else {
        const otherRegion = all.filter(c => regionOf(c.el) !== activeRegion)
        pick = pickInDirection(cur, otherRegion, dir, /* cone */ false)
        // Entering a region lands on its default (the Settings rail's current category), not on
        // whichever of its items happens to be nearest.
        const entered = pick ? regionOf(pick.el) : null
        const preferred = entered?.querySelector<HTMLElement>('[data-nav-region-default]')
        if (preferred && preferred !== active && els.includes(preferred)) {
          pick = { id: '', rect: preferred.getBoundingClientRect(), el: preferred }
          entersRegionDefault = true
        }
      }
    }
    if (pick?.el) {
      // Focus WITHOUT the browser's instant jump-scroll, then smooth-scroll ONLY along the axis
      // we moved: horizontal moves scroll the row horizontally (block:nearest avoids a vertical
      // re-center jitter on every left/right); vertical moves scroll the page vertically. A
      // region's default is the one exception: it is also revealed inside its own region's pane.
      const target = rovingEntry(pick.el, active)
      target.focus({ preventScroll: true })
      if (entersRegionDefault) revealRegionEntry(target, vertical, e.repeat)
      else revealFocused(target, vertical, e.repeat)
      e.preventDefault()
    }
  }
  host[NAV_KEYDOWN] = onKeydown
  window.addEventListener('keydown', onKeydown)
}
