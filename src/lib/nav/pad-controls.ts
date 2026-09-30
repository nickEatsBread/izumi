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
