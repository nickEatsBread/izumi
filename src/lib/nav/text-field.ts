// One answer to "is this a field you type into?": a textarea, or an input that takes typed text.
// Controller code treats such a field differently from a control the pad operates directly: the
// source picker's d-pad order passes over it, and the on-screen keyboard is only ever for it. Never
// imports ./index or ./gamepad, so every nav module can share it.

export type TextEntryField = HTMLInputElement | HTMLTextAreaElement

/** Input types that take no typed text. The date/time family is here on purpose: the keyboard cannot
 *  build a valid value for them, so it must never open on one (and wipe it). */
export const NON_TEXT_INPUT_TYPES: readonly string[] = [
  'checkbox', 'radio', 'range', 'color', 'button', 'submit', 'reset', 'file', 'image', 'hidden',
  'date', 'time', 'month', 'week', 'datetime-local',
]

/** A textarea, or an input whose type takes text (text, search, url, email, tel, password, number,
 *  and unknown types, which the DOM reads as text), that is not read-only, not disabled and not a
 *  clipboard proxy (the hidden textarea src/lib/util/clipboard.ts focuses to copy). */
export function isTextEntryField(el: EventTarget | null | undefined): el is TextEntryField {
  if (typeof HTMLTextAreaElement === 'undefined') return false
  if (el instanceof HTMLTextAreaElement) {
    return !el.readOnly && !el.disabled && el.dataset.clipboardProxy === undefined
  }
  if (!(el instanceof HTMLInputElement) || NON_TEXT_INPUT_TYPES.includes(el.type)) return false
  return !el.readOnly && !el.disabled && el.dataset.clipboardProxy === undefined
}
