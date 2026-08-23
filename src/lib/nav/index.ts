import { get } from 'svelte/store'
import { gameMode, playing } from '$lib/player/session'
import { pickInDirection, type Dir } from './spatial'
export * from './input'
export * from './actions'
export * from './spatial'

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

/** Reveal controller focus without asking scrollIntoView to move every scrollable ancestor. The
 * settings category rail owns its own viewport; moving it must never scroll the category content. */
function revealFocused(el: HTMLElement, vertical: boolean, rapid = false): void {
  // Do not stack smooth-scroll animations while a direction is held. WebKit queues those and then
  // repaints/decode-rushes several rows at once, which looked like a DOM freeze followed by flashes.
  // A deliberate Deck press should still glide to the next row/card; only the generated repeat
  // edges use an immediate reveal. That keeps home/detail navigation fluid without building a
  // queue when the user holds the stick or D-pad down.
  const behavior: ScrollBehavior = rapid ? 'auto' : 'smooth'
  const pane = el.closest<HTMLElement>('[data-nav-scroll-container]')
  if (!pane) {
    el.scrollIntoView({
      behavior,
      block: vertical ? 'center' : 'nearest',
      inline: vertical ? 'nearest' : 'center',
    })
    return
  }
  const item = el.getBoundingClientRect()
  const port = pane.getBoundingClientRect()
  const top = item.top < port.top ? item.top - port.top : item.bottom > port.bottom ? item.bottom - port.bottom : 0
  const left = item.left < port.left ? item.left - port.left : item.right > port.right ? item.right - port.right : 0
  if (top || left) pane.scrollBy({ top, left, behavior })
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
    const els = [...root.querySelectorAll<HTMLElement>('[data-focusable]')]
      .filter(el => el.checkVisibility?.() ?? true)
      // A disabled button can't be actioned, so skip it as a nav target — otherwise `down` from the
      // last episode row dead-ends on a greyed-out Prev/Next. (Only real `disabled` buttons: divs
      // with `aria-disabled`, like unaired episodes, stay focusable on purpose.)
      .filter(el => !(el instanceof HTMLButtonElement && el.disabled))
    const active = document.activeElement as HTMLElement
    const vertical = dir === 'up' || dir === 'down'
    // No real focus yet (just opened / focus sits on <body>): the FIRST press must land on the
    // first content focusable — NOT spatial-search from <body>'s full-page rect, which measures
    // "down" from the whole viewport and flings focus deep into the grid (the "jumps to romance,
    // 3rd card" bug). Prefer the first non-sidebar focusable (the hero button) so the row is next.
    if (!active?.closest?.('[data-focusable]') || (trap && !trap.contains(active))) {
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
      ? els.find((el) => el !== active && el.getAttribute('data-nav-id') === explicitName)
      : undefined
    if (explicit) {
      explicit.focus({ preventScroll: true })
      revealFocused(explicit, vertical, e.repeat)
      e.preventDefault()
      return
    }
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
