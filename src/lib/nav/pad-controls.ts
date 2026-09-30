// Controller key delivery. The gamepad router turns d-pad presses (and X into `d`) into keydown
// events dispatched on `window`, where a desktop keyboard's keys also land when nothing is focused.
// Consumers that must treat those differently from a real keyboard (the player hotkeys, the shell
// hotkeys, a text field's claim on the arrows) read the mark with `isPadEvent`.
//
// The mark is a registered symbol defined on the event object itself. A registered symbol is the
// same value in every copy of this module, so a Vite HMR reload or a duplicate module instance
// still recognises events made by the other copy; a module-level WeakSet would not.
//
// This module never imports `./index` or `./gamepad` (contract §2 import graph). Commits 2, 4 and 5
// add padActivate, the slider adapter and the select chooser branch here.

import type { Dir } from './spatial'
import { padOpenPicker } from './native-picker'

/** Registered symbol marking a synthetic pad key on the event object itself. */
export const PAD_KEY: symbol = Symbol.for('izumi.padKey')

export interface PadKeyOptions { repeat?: boolean }

/** Dispatch one pad key on `window`: a bubbling, cancelable keydown marked with PAD_KEY. Arrows and
 *  X's `d` stay window-targeted on purpose: aimed at the focused element they would reach its own
 *  keyboard handlers (a dropdown that opens on ArrowDown, a text caret, the player's seek keys).
 *  Returns the dispatched event. */
export function dispatchPadKey(key: string, options: PadKeyOptions = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, repeat: options.repeat ?? false })
  Object.defineProperty(event, PAD_KEY, { value: true })
  window.dispatchEvent(event)
  return event
}

/** True only when the event carries the pad mark (null and undefined read as unmarked). */
export function isPadEvent(event: Event | null | undefined): boolean {
  return !!event && (event as unknown as Record<symbol, unknown>)[PAD_KEY] === true
}

/** A-button activation of `el` (omitted: the focused element), shared by every controller owner.
 *  False only when there is nothing to act on (null, no focused element, or <body>). A disabled control
 *  (`:disabled` or aria-disabled="true") consumes the press and does nothing; a range does nothing
 *  (Left/Right step it, commit 4); a <summary> toggles its <details> even in an engine where a
 *  synthetic click does not; everything else is clicked, exactly as the A button always did. */
export function padActivate(el?: Element | null): boolean {
  // Off TV, an enabled single <select> opens the app-drawn chooser, because a synthetic click cannot
  // open WebKitGTK's popup under gamescope. TV, disabled selects, list boxes and selects under a
  // modal <dialog> fall through to the rules below (TV keeps the click).
  if (padOpenPicker(el === undefined ? (typeof document === 'undefined' ? null : document.activeElement) : el)) return true
  // An omitted argument means "the focused element"; an explicit null means "nothing".
  const target = el === undefined ? (typeof document === 'undefined' ? null : document.activeElement) : el
  if (!target || !(target instanceof HTMLElement) || target === target.ownerDocument.body) return false
  if (target.matches(':disabled') || target.getAttribute('aria-disabled') === 'true') return true
  if (target instanceof HTMLInputElement && target.type === 'range') return true
  if (target.tagName === 'SUMMARY') {
    const details = target.parentElement instanceof HTMLDetailsElement ? target.parentElement : null
    const wasOpen = details?.open
    target.click()
    if (details && details.open === wasOpen) details.open = !wasOpen
    return true
  }
  target.click()
  return true
}

// ── Sliders ─────────────────────────────────────────────────────────────────────────────────────
// A synthetic arrow never runs a range input's native default action, so the pad steps sliders
// here: the value a keyboard step would give (snapped to the grid, clamped, rounded to the step's
// decimals), then `input` and `change` like a real drag, so bindings and live previews follow.

export interface RangeInput { value: number | string; min?: number | string; max?: number | string; step?: number | string }

interface RangeBounds { min: number; max: number; step: number }

/** Held repeats before the step grows… */
const ACCELERATE_AFTER_REPEATS = 6
/** …to a size that crosses the whole slider in about this many presses. */
const SWEEP_PRESSES = 40
/** Float slack when snapping: 0.7 / 0.1 is 6.999999999999999, not 7. */
const SNAP_EPSILON = 1e-9

/** A numeric attribute, or `fallback` when it is missing, empty or not a finite number. */
function numberOr(raw: number | string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

/** min/max/step as a range input reads them: min 0, max 100 and step 1 when missing; a max below
 *  min collapses onto min; step "any", zero, negative or unparsable is a hundredth of the span. */
function rangeBounds(range: RangeInput): RangeBounds {
  const min = numberOr(range.min, 0)
  const max = Math.max(min, numberOr(range.max, 100))
  const declared = range.step === undefined || range.step === '' ? 1 : Number(range.step)
  const step = Number.isFinite(declared) && declared > 0 ? declared : (max - min) / 100
  return { min, max, step }
}

/** Decimal places `value` is written with (0.01 → 2, 1e-7 → 7), capped at 10. */
function decimalPlaces(value: number): number {
  if (!Number.isFinite(value)) return 0
  const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e')
  const fraction = mantissa.split('.')[1]?.length ?? 0
  return Math.min(10, Math.max(0, fraction - Number(exponent)))
}

/** The value one pad step (× `multiplier`) away from `range.value`. Pure. */
export function nextRangeValue(
  range: RangeInput,
  direction: -1 | 1,
  options: { rtl?: boolean; multiplier?: number } = {},
): number {
  const { min, max, step } = rangeBounds(range)
  const current = Math.min(max, Math.max(min, numberOr(range.value, min + (max - min) / 2)))
  if (!(step > 0)) return current
  const sign = options.rtl ? -direction : direction
  const requested = Math.floor(options.multiplier ?? 1)
  const multiplier = Number.isFinite(requested) && requested > 1 ? requested : 1
  // Grid index after the move. An off-grid start snaps to the next grid point in the direction of
  // travel (floor going up, ceil going down), so a press always moves and never skips a point.
  const position = (current - min) / step + sign * multiplier
  const index = sign > 0 ? Math.floor(position + SNAP_EPSILON) : Math.ceil(position - SNAP_EPSILON)
  const places = Math.max(decimalPlaces(step), decimalPlaces(min))
  const snapped = Number((min + index * step).toFixed(places))
  // Clamping last makes a max that sits off the grid reachable.
  const next = Math.min(max, Math.max(min, snapped))
  return next === 0 ? 0 : next
}

/** Step multiplier for a held direction: 1 until the sixth repeat, then a sweep in ~40 presses. */
export function padRangeMultiplier(repeatCount: number, totalSteps: number): number {
  if (!(repeatCount >= ACCELERATE_AFTER_REPEATS) || !Number.isFinite(totalSteps)) return 1
  return Math.max(1, Math.ceil(totalSteps / SWEEP_PRESSES))
}

// The held-direction counter behind the acceleration. A new element, a new direction or a fresh
// (non-repeat) press starts it over.
let adjustTarget: Element | null = null
let adjustDir: Dir | null = null
let adjustRepeats = 0

function isRangeInput(el: Element | null): el is HTMLInputElement {
  return !!el && el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'range'
}

/** Pad Left/Right on an enabled slider: one (accelerating) step via nextRangeValue, then bubbling
 *  `input` and `change`. True when the press is the slider's, including a press at a bound, which
 *  changes nothing and fires nothing (focus must not slide off the end of the slider). False for
 *  Up/Down and for anything that is not an enabled range input. Callers gate on !isTv. */
export function padAdjust(el: Element | null, dir: Dir, repeat: boolean): boolean {
  if (dir !== 'left' && dir !== 'right') return false
  if (!isRangeInput(el) || el.matches(':disabled') || el.closest('[inert]')) return false
  adjustRepeats = repeat && el === adjustTarget && dir === adjustDir ? adjustRepeats + 1 : 0
  adjustTarget = el
  adjustDir = dir
  const { min, max, step } = rangeBounds(el)
  const totalSteps = step > 0 ? Math.round((max - min) / step) : 0
  const rtl = el.ownerDocument.defaultView?.getComputedStyle(el).direction === 'rtl'
  const next = nextRangeValue(el, dir === 'right' ? 1 : -1, {
    rtl,
    multiplier: padRangeMultiplier(adjustRepeats, totalSteps),
  })
  const before = el.value
  el.value = String(next)
  // The browser re-sanitises the value (step mismatch, bounds); unchanged means "at a bound".
  if (el.value === before) return true
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return true
}

/** Test hook: forget the held-direction counter. */
export function resetPadControlsForTests(): void {
  adjustTarget = null
  adjustDir = null
  adjustRepeats = 0
}
