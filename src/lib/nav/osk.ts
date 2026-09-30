import { get, writable, type Readable } from 'svelte/store'
import { bumpPlayerOverlay, gameMode, oskOpen, playing } from '$lib/player/session'
import { isTv } from '$lib/platform'
import { deckKeyboardWarning } from '$lib/deck/keyboard-warning'
import { controllerMode, inputType } from './input'
import { isPadEvent } from './pad-controls'
import { isTextEntryField, type TextEntryField } from './text-field'
import { focusNearestFocusable } from './index'

// The built-in on-screen keyboard's behaviour. OnScreenKeyboard.svelte is only its view, so every
// rule here can be tested without Svelte (settings fix pass, owner decisions 3, 6 and 7):
// - under a controller (Steam Deck Game mode, or a pad on a phone or desktop) the d-pad passes over
//   text fields, A (a click) opens the keyboard, and closing it returns focus to the same field;
// - Done presses the form's enabled default button, and only from the form's last field;
// - typing-only launchers (global search, settings search, the searchable language menu) open it at
//   once through openOskForField;
// - Android TV keeps opening it on focus ('focus-legacy'); mouse, touch and keyboard users never
//   see it ('off').

export type OskPolicy = 'activate' | 'focus-legacy' | 'off'
export type OskLayout = 'text' | 'numeric'
export interface RemoteKeyboard { insert(text: string): void; backspace(): void; submit(): void; close?(): void }
export type OskSession =
  | { kind: 'field'; field: TextEntryField; policy: OskPolicy; layout: OskLayout; initialValue: string; draft: string }
  | { kind: 'remote'; remote: RemoteKeyboard; layout: 'text' }

const NUMERIC_INPUT_MODES = ['numeric', 'decimal', 'tel']
/** Input types that block implicit submission (HTML's "fields that block implicit submission"). */
const BLOCKING_INPUT_TYPES = ['text', 'search', 'url', 'tel', 'email', 'password', 'date', 'month', 'week', 'time', 'datetime-local', 'number']

/** Each field's own `inputmode` (null = none) while the keyboard has set it to `none`. */
let originalInputMode = new WeakMap<TextEntryField, string | null>()

/** gameMode wins over isTv; isTv wins over controllerMode. */
export function oskPolicy(input: { gameMode: boolean; isTv: boolean; controllerMode: boolean }): OskPolicy {
  if (input.gameMode) return 'activate'
  if (input.isTv) return 'focus-legacy'
  if (input.controllerMode) return 'activate'
  return 'off'
}

export function currentOskPolicy(): OskPolicy {
  return oskPolicy({ gameMode: get(gameMode), isTv: get(isTv), controllerMode: get(controllerMode) })
}

/** A keypad for inputmode numeric/decimal/tel and type number/tel; letters otherwise. Reads the
 *  field's own inputmode even while the keyboard has replaced it with `none`. */
export function oskLayoutFor(field: TextEntryField): OskLayout {
  const mode = originalInputMode.has(field) ? originalInputMode.get(field) ?? null : field.getAttribute('inputmode')
  if (mode && NUMERIC_INPUT_MODES.includes(mode)) return 'numeric'
  if (field instanceof HTMLInputElement && (field.type === 'number' || field.type === 'tel')) return 'numeric'
  return 'text'
}

/** The target is the keyboard or inside it. Every outside-press closer returns early on this, so a
 *  tap on a key never closes the menu or popover the keyboard is typing into. */
export function isOskTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('[data-osk]')
}

/** What Done presses (decision 6, HTML implicit submission): from the form's LAST blocking field
 *  only; the default button (the first submit button) when it is enabled, nothing when it is
 *  disabled; the form itself only when it has one blocking field and no submit button. */
export function implicitSubmitTarget(field: TextEntryField): HTMLButtonElement | HTMLInputElement | HTMLFormElement | null {
  if (!(field instanceof HTMLInputElement)) return null
  const form = field.form
  if (!form) return null
  const controls = [...form.elements]
  const blocking = controls.filter((el): el is HTMLInputElement => el instanceof HTMLInputElement && BLOCKING_INPUT_TYPES.includes(el.type))
  if (blocking.at(-1) !== field) return null
  const submitter = controls.find((el): el is HTMLButtonElement | HTMLInputElement =>
    (el instanceof HTMLButtonElement && el.type === 'submit') || (el instanceof HTMLInputElement && el.type === 'submit'))
  if (submitter) return submitter.disabled ? null : submitter
  return blocking.length === 1 ? form : null
}

const NUMERIC_CHAR = /[0-9.-]/
/** A value an input[type=number] keeps; '-', '1.' and the like would blank it. */
const VALID_NUMBER = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/
/** Android TV: a focus arriving this soon after a close is the keyboard's own focus return. */
const LEGACY_REOPEN_GUARD_MS = 400

const session = writable<OskSession | null>(null)
/** The open session, or null. Every change is mirrored into `oskOpen` ($lib/player/session). */
export const oskSession: Readable<OskSession | null> = { subscribe: session.subscribe }

type OskEcho = { label: string; value: string; masked: boolean }
const echo = writable<OskEcho | null>(null)
/** The aria-hidden echo row above the keys: the field's label and what it holds (the number draft
 *  for type=number), masked for passwords. null for remote sessions and while closed. */
export const oskEcho: Readable<OskEcho | null> = { subscribe: echo.subscribe }

let fieldRect: { left: number; top: number; width: number; height: number } | null = null
let restoringFocus = false
let closedAt = -1e9

const isNumberField = (field: TextEntryField): field is HTMLInputElement =>
  field instanceof HTMLInputElement && field.type === 'number'

/** Game mode during playback shows HTML over mpv only through the player's snapshot. */
function bump(): void {
  if (get(gameMode) && get(playing)) bumpPlayerOverlay()
}

function labelOf(field: TextEntryField): string {
  const labelledBy = (field.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '').join(' ')
  for (const candidate of [field.getAttribute('aria-label'), labelledBy, field.labels?.[0]?.textContent, field.placeholder]) {
    const text = (candidate ?? '').replace(/\s+/g, ' ').trim()
    if (text) return text.slice(0, 60)
  }
  return ''
}

function refreshEcho(): void {
  const current = get(session)
  if (current?.kind !== 'field') {
    echo.set(null)
    return
  }
  const { field } = current
  const value = isNumberField(field) ? current.draft : field.value
  const masked = field instanceof HTMLInputElement && field.type === 'password'
  echo.set({ label: labelOf(field), value: masked ? '•'.repeat(value.length) : value, masked })
}

function setSession(next: OskSession | null): void {
  session.set(next)
  oskOpen.set(next !== null)
  refreshEcho()
}

/** Android: keep the system IME down while the d-pad or this keyboard owns the field. */
function suppressIme(field: TextEntryField): void {
  if (!originalInputMode.has(field)) originalInputMode.set(field, field.getAttribute('inputmode'))
  field.setAttribute('inputmode', 'none')
}

/** Put the field's own inputmode back (a PIN gets its numeric system keyboard again). */
function restoreIme(field: TextEntryField): void {
  if (!originalInputMode.has(field)) return
  const original = originalInputMode.get(field) ?? null
  originalInputMode.delete(field)
  if (original === null) field.removeAttribute('inputmode')
  else field.setAttribute('inputmode', original)
}

/** A field the keyboard can serve. The keyboard is portalled to <body>, which is inert under an open
 *  modal <dialog> (a known limit of this pass), so a field inside one gets no keyboard at all rather
 *  than one it can never reach, and keeps its system IME. */
function servesField(target: EventTarget | null | undefined): target is TextEntryField {
  if (!isTextEntryField(target)) return false
  const dialog = target.closest('dialog')
  if (!dialog?.open) return true
  try {
    return !dialog.matches(':modal')
  } catch {
    return false
  }
}

function usable(field: TextEntryField): boolean {
  return field.isConnected && !field.disabled && (field.checkVisibility?.() ?? true) && !field.closest('[inert]')
}

/** Focus the field without the focus-to-open listener (Android TV) taking it as a new open. */
function focusField(field: TextEntryField): void {
  restoringFocus = true
  try {
    field.focus({ preventScroll: true })
  } finally {
    restoringFocus = false
  }
}

function selectionOf(field: TextEntryField): [number, number] {
  const end = field.value.length
  try {
    return [field.selectionStart ?? end, field.selectionEnd ?? end]
  } catch {
    return [end, end]
  }
}

function writeValue(field: TextEntryField, value: string, caret?: number): void {
  const before = field.value
  field.value = value
  if (caret !== undefined) {
    try { field.setSelectionRange(caret, caret) } catch { /* number and email inputs have no caret */ }
  }
  if (field.value !== before) field.dispatchEvent(new Event('input', { bubbles: true }))
}

function openFieldSession(field: TextEntryField, policy: OskPolicy): void {
  const current = get(session)
  if (current?.kind === 'field' && current.field === field) return
  if (current) closeOsk({ restore: false })
  const layout = oskLayoutFor(field)
  suppressIme(field)
  const rect = field.getBoundingClientRect()
  fieldRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  // The keyboard has no cursor keys, so typing continues from the end of what is there.
  try { field.setSelectionRange(field.value.length, field.value.length) } catch { /* no caret */ }
  setSession({ kind: 'field', field, policy, layout, initialValue: field.value, draft: field.value })
  bump()
}

/** Close `field`'s session only if it is still the open one. A handler that Done ran (an Enter
 *  keydown handler, the submit) may already have opened the keyboard on another field; that new
 *  session stays. Compares by field, not by object: Done replaces the session object when it
 *  commits the value. */
function closeIfStill(field: TextEntryField, options?: { restore?: boolean }): void {
  const after = get(session)
  if (after?.kind === 'field' && after.field === field) closeOsk(options)
}

/** Decision 7's opt-in for typing-only launchers (global search, settings search, the searchable
 *  language menu): open at once instead of waiting for A. False, and nothing happens, for mouse,
 *  touch and keyboard users ('off') and for fields the keyboard cannot serve. */
export function openOskForField(field: TextEntryField): boolean {
  const policy = currentOskPolicy()
  if (policy === 'off' || !servesField(field)) return false
  openFieldSession(field, policy)
  return true
}

/** A keyboard for a field this document cannot reach (the comments composer's cross-origin frame). */
export function openRemoteOsk(remote: RemoteKeyboard): void {
  if (get(session)) closeOsk({ restore: false })
  setSession({ kind: 'remote', remote, layout: 'text' })
  bump()
}

/** Type at the caret: maxLength holds, a keypad drops everything but digits, '.' and '-', and a
 *  number field keeps a draft that reaches the field only once it is a valid number. Fires a
 *  bubbling `input` only when the value changed. */
export function oskInsert(text: string): void {
  const current = get(session)
  if (!current) return
  if (current.kind === 'remote') {
    current.remote.insert(text)
    bump()
    return
  }
  const { field } = current
  if (!field.isConnected) {
    closeOsk()
    return
  }
  const typed = current.layout === 'numeric' ? [...text].filter((ch) => NUMERIC_CHAR.test(ch)).join('') : text
  if (!typed) return
  if (isNumberField(field)) {
    const draft = current.draft + typed
    session.set({ ...current, draft })
    if (VALID_NUMBER.test(draft)) writeValue(field, draft)
  } else {
    const [start, end] = selectionOf(field)
    const room = field.maxLength >= 0 ? field.maxLength - (field.value.length - (end - start)) : typed.length
    const insert = typed.slice(0, Math.max(0, room))
    if (!insert) return
    writeValue(field, field.value.slice(0, start) + insert + field.value.slice(end), start + insert.length)
  }
  refreshEcho()
  bump()
}

/** Delete the character before the caret (or the selection); a number field edits its draft. */
export function oskBackspace(): void {
  const current = get(session)
  if (!current) return
  if (current.kind === 'remote') {
    current.remote.backspace()
    bump()
    return
  }
  const { field } = current
  if (!field.isConnected) {
    closeOsk()
    return
  }
  if (isNumberField(field)) {
    const draft = current.draft.slice(0, -1)
    session.set({ ...current, draft })
    if (draft === '' || VALID_NUMBER.test(draft)) writeValue(field, draft)
  } else {
    const [start, end] = selectionOf(field)
    if (start === end && start === 0) return
    const from = start === end ? start - 1 : start
    writeValue(field, field.value.slice(0, from) + field.value.slice(end), from)
  }
  refreshEcho()
  bump()
}

/** Done. A controller field session: focus back on the field, commit (`change`), a cancellable
 *  Enter keydown on it for fields that act on Enter, then, unless that was prevented, the implicit
 *  submission (decision 6); then close, unless a handler already moved the keyboard to another
 *  field. Android TV keeps today's plain Enter with no submit and no refocus. A remote session
 *  submits its composer. */
export function oskDone(): void {
  const current = get(session)
  if (!current) return
  if (current.kind === 'remote') {
    current.remote.submit()
    // The composer's submit may itself have closed or replaced the session.
    if (get(session) === current) closeOsk()
    return
  }
  const { field } = current
  if (current.policy === 'focus-legacy') {
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    closeIfStill(field, { restore: false })
    return
  }
  if (!usable(field)) {
    closeOsk()
    return
  }
  focusField(field)
  if (field.value !== current.initialValue) {
    // Commit first, as a native field does on Enter, so a submit handler sees the saved value.
    field.dispatchEvent(new Event('change', { bubbles: true }))
    if (get(session) === current) session.set({ ...current, initialValue: field.value })
  }
  const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  field.dispatchEvent(enter)
  if (!enter.defaultPrevented) {
    const target = implicitSubmitTarget(field)
    if (target instanceof HTMLFormElement) target.requestSubmit()
    else target?.click()
  }
  closeIfStill(field)
}

/** Close the keyboard. With `restore` (the default), focus goes back to the field when it is still
 *  on the keys (or nowhere) and the field is connected, enabled, visible and not inert; otherwise to
 *  the nearest control (focusNearestFocusable). Then a bubbling `change` when the value changed.
 *  Under 'activate' the refocus cannot reopen it (only a click opens). The gamepad B path stamps
 *  `oskDismissedAt` itself; this does not. */
export function closeOsk(options: { restore?: boolean } = {}): void {
  const current = get(session)
  if (!current) {
    // A mirror left true without a session (e.g. across a hot reload) must never trap the pad.
    if (get(oskOpen)) oskOpen.set(false)
    return
  }
  const active = document.activeElement
  const focusOnKeys = !active || active === document.body || isOskTarget(active)
  closedAt = performance.now()
  setSession(null)
  if (current.kind === 'remote') {
    current.remote.close?.()
    bump()
    return
  }
  const { field } = current
  if ((options.restore ?? true) && focusOnKeys) {
    if (usable(field)) focusField(field)
    else {
      const now = field.getBoundingClientRect()
      const anchor = now.width || now.height ? now : fieldRect
      if (anchor) focusNearestFocusable(anchor)
    }
  }
  if (field.isConnected && field.value !== current.initialValue) field.dispatchEvent(new Event('change', { bubbles: true }))
  if (document.activeElement !== field) restoreIme(field)
  fieldRect = null
  bump()
}

export function resetOskForTests(): void {
  session.set(null)
  oskOpen.set(false)
  echo.set(null)
  originalInputMode = new WeakMap()
  fieldRect = null
  restoringFocus = false
  closedAt = -1e9
}

/** Install the keyboard's listeners; returns the uninstaller. Called once, from OnScreenKeyboard's
 *  onMount at app boot, so its window capture listeners run before any player, menu or layer
 *  listener registered later. */
export function startOsk(): () => void {
  // 'activate': A (the pad's click), a Game-mode tap, a trackpad click or a <label> click opens it.
  const onClick = (event: MouseEvent) => {
    if (currentOskPolicy() !== 'activate') return
    const target = event.target
    if (isOskTarget(target) || !servesField(target)) return
    openFieldSession(target, 'activate')
  }
  const onFocusIn = (event: FocusEvent) => {
    const target = event.target
    if (isOskTarget(target)) {
      bump() // a d-pad move between keys repaints the Game-mode snapshot
      return
    }
    if (!isTextEntryField(target)) return
    const policy = currentOskPolicy()
    if (policy === 'off') return
    // Only a field the keyboard can serve loses its system IME: one inside an open modal <dialog>
    // gets no built-in keyboard, so it keeps its own (Android TV, a phone with a pad).
    const served = servesField(target)
    if (served && get(inputType) === 'dpad') suppressIme(target)
    // Android TV keeps opening on focus, except for the keyboard's own focus return.
    if (policy !== 'focus-legacy' || restoringFocus) return
    if (performance.now() - closedAt < LEGACY_REOPEN_GUARD_MS) return
    if (served) openFieldSession(target, 'focus-legacy')
  }
  const onFocusOut = (event: FocusEvent) => {
    const target = event.target
    if (!isTextEntryField(target)) return
    const current = get(session)
    if (current?.kind === 'field' && current.field === target) return
    restoreIme(target)
  }
  const onKeydown = (event: KeyboardEvent) => {
    if (!get(session)) return
    if (event.key === 'Escape' || event.key === 'GoBack' || event.key === 'BrowserBack') {
      // Keyboard Escape, the TV remote's Back (MainActivity's Escape) and the phone bridge close only
      // the keyboard: nothing registered later (player, track menu, layers, dialogs) sees the key.
      event.preventDefault()
      event.stopImmediatePropagation()
      closeOsk()
      return
    }
    if (isPadEvent(event) || event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return
    // A physical keyboard: type the character into the field, then get out of the way.
    event.preventDefault()
    event.stopImmediatePropagation()
    oskInsert(event.key)
    closeOsk()
  }
  const onPointerDown = (event: PointerEvent) => {
    const target = event.target
    if (isOskTarget(target)) return
    const current = get(session)
    // Game mode: a tap on the field being typed into leaves the keyboard up.
    if (current?.kind === 'field' && current.field === target && get(gameMode)) return
    if (current) {
      closeOsk({ restore: false })
      if (current.kind === 'field') restoreIme(current.field)
    }
    // A touched field gets its own system keyboard (and a PIN its numeric layout) back.
    if (isTextEntryField(target)) restoreIme(target)
  }
  const onRemoteOpen = (event: Event) => {
    if (currentOskPolicy() === 'off') return
    const detail = (event as CustomEvent<RemoteKeyboard | undefined>).detail
    if (!detail?.insert || !detail.backspace || !detail.submit) return
    openRemoteOsk(detail)
  }
  const onClose = () => closeOsk()
  // The Steam keyboard warning takes the pad: close with focus back on the field, which the warning
  // hands focus back to when it goes (DeckKeyboardWarning.svelte).
  const stopWarning = deckKeyboardWarning.subscribe((warning) => {
    if (warning && get(session)) closeOsk()
  })
  window.addEventListener('click', onClick, true)
  window.addEventListener('focusin', onFocusIn, true)
  window.addEventListener('focusout', onFocusOut, true)
  window.addEventListener('keydown', onKeydown, true)
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('osk-remote-open', onRemoteOpen)
  window.addEventListener('osk-close', onClose)
  return () => {
    stopWarning()
    window.removeEventListener('click', onClick, true)
    window.removeEventListener('focusin', onFocusIn, true)
    window.removeEventListener('focusout', onFocusOut, true)
    window.removeEventListener('keydown', onKeydown, true)
    window.removeEventListener('pointerdown', onPointerDown, true)
    window.removeEventListener('osk-remote-open', onRemoteOpen)
    window.removeEventListener('osk-close', onClose)
  }
}
