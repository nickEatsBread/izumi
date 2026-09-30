import { get, writable, type Readable } from 'svelte/store'
import { tick } from 'svelte'
import { isTv } from '$lib/platform'
import { oskOpen } from '$lib/player/session'
import { describeFocus, restoreFocus, type FocusDescriptor } from './focus-memory'

// The pad's chooser for a native <select>. A synthetic click cannot open WebKitGTK's popup under
// gamescope, so off TV pad A (padActivate → padOpenPicker) opens an app-drawn list instead.
// NativePickerSheet.svelte draws it; every rule lives here so jsdom can test it. Touch and mouse keep
// the native popup and TV keeps the click, whose system dialog works there. Never imports ./index or
// ./gamepad, so pad-controls.ts can import it without a cycle.

export interface NativePickerOption {
  /** The option element itself: the commit selects by identity, never by value, so numeric and
   *  object values bound through Svelte's `__value` and duplicate empty values stay exact. */
  option: HTMLOptionElement
  label: string
  /** The option or its optgroup is disabled. */
  disabled: boolean
  selected: boolean
  /** The enclosing optgroup's label, or null outside a group. */
  group: string | null
}

const FALLBACK_TITLE = 'Choose an option'
const collapse = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim()
const groupOf = (option: HTMLOptionElement) =>
  option.parentElement instanceof HTMLOptGroupElement ? option.parentElement : null

/** A modal <dialog> is shown (showModal). Its top layer covers the chooser, which is mounted in the
 *  app layout: it would be drawn under the dialog and blocked while still owning the pad. An engine
 *  that cannot answer `:modal` counts an open dialog as modal, because the plain click is the safe
 *  side (izumi opens every <dialog> with showModal). */
function modalDialogShown(doc: Document): boolean {
  for (const dialog of doc.querySelectorAll('dialog[open]')) {
    try {
      if (dialog.matches(':modal')) return true
    } catch {
      return true
    }
  }
  return false
}

/** An enabled single-choice select the chooser can drive: not `multiple` or `size > 1` (a list box
 *  has no popup and keeps its native behaviour), not :disabled or aria-disabled="true" (pad A
 *  consumes the press on those and does nothing), not inside inert content, and no modal <dialog>
 *  shown anywhere on the page. */
export function isPickableSelect(el: Element | null | undefined): el is HTMLSelectElement {
  if (typeof HTMLSelectElement === 'undefined' || !(el instanceof HTMLSelectElement)) return false
  if (el.multiple || el.size > 1) return false
  if (el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true') return false
  return !el.closest('[inert]') && !modalDialogShown(el.ownerDocument)
}

/** The select's options in DOM order, without hidden ones (placeholders). */
export function readSelectOptions(select: HTMLSelectElement): NativePickerOption[] {
  return [...select.options]
    .filter((option) => !option.hidden)
    .map((option) => {
      const group = groupOf(option)
      return {
        option,
        label: collapse(option.getAttribute('label')) || collapse(option.text) || option.value,
        disabled: option.disabled || !!group?.disabled,
        selected: option.selected,
        group: group ? collapse(group.getAttribute('label')) || null : null,
      }
    })
}

/** The wrapping <label>, else a separate <label for="id">. */
function labelFor(control: HTMLElement): HTMLLabelElement | null {
  const wrapping = control.closest('label')
  if (wrapping) return wrapping
  if (!control.id) return null
  for (const label of control.ownerDocument.querySelectorAll<HTMLLabelElement>('label[for]')) {
    if (label.htmlFor === control.id) return label
  }
  return null
}

/** The label's text that comes before the control (all of it for a separate label[for]). */
function labelTextBefore(label: HTMLLabelElement, control: HTMLElement): string {
  if (!label.contains(control)) return collapse(label.textContent)
  const walker = control.ownerDocument.createTreeWalker(label, NodeFilter.SHOW_TEXT)
  let text = ''
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (control.contains(node)) continue
    if (control.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING) text += ` ${node.nodeValue ?? ''}`
  }
  return collapse(text)
}

/** The chooser's heading: data-picker-title > aria-label > aria-labelledby text > the label's title
 *  attribute (StreamPicker's chips) > the label's text before the control > 'Choose an option'. The
 *  label is the wrapping <label>, else a separate <label for> (profiles' age limit, sync's account). */
export function pickerTitle(control: HTMLElement): string {
  const explicit = collapse(control.dataset.pickerTitle)
  if (explicit) return explicit
  const aria = collapse(control.getAttribute('aria-label'))
  if (aria) return aria
  const labelledBy = collapse(control.getAttribute('aria-labelledby'))
    .split(' ')
    .filter(Boolean)
    .map((id) => collapse(control.ownerDocument.getElementById(id)?.textContent))
    .filter(Boolean)
    .join(' ')
  if (labelledBy) return labelledBy
  const label = labelFor(control)
  if (label) {
    const title = collapse(label.getAttribute('title'))
    if (title) return title
    const text = labelTextBefore(label, control)
    if (text) return text
  }
  return FALLBACK_TITLE
}

/** Select exactly `option`: selectedIndex = its index in select.options, then a bubbling `input` and
 *  `change` (Svelte's bind:value reads the option's `__value` on change), only when the selection
 *  changed. A disabled option (or one in a disabled optgroup) is never selected. 'missing' when the
 *  option is no longer in the select: the caller re-reads the options and stays open. */
export function commitPickerOption(select: HTMLSelectElement, option: HTMLOptionElement): 'changed' | 'unchanged' | 'missing' {
  const index = [...select.options].indexOf(option)
  if (index < 0) return 'missing'
  if (option.disabled || groupOf(option)?.disabled || select.selectedIndex === index) return 'unchanged'
  select.selectedIndex = index
  select.dispatchEvent(new Event('input', { bubbles: true }))
  select.dispatchEvent(new Event('change', { bubbles: true }))
  return 'changed'
}

const usable = (row: HTMLElement) => !row.matches(':disabled') && row.getAttribute('aria-disabled') !== 'true'

/** The next usable row from `current` in DOM order, clamped at the ends (the current row stays).
 *  From outside the rows (focus left behind the sheet, which WebKitGTK does behind snapshotted
 *  modals) it enters at the first usable row going down, the last going up. */
export function stepPickerRow(rows: readonly HTMLElement[], current: Element | null, dir: 1 | -1): HTMLElement | null {
  const index = current ? rows.indexOf(current as HTMLElement) : -1
  if (index < 0) return (dir === 1 ? rows.find(usable) : [...rows].reverse().find(usable)) ?? null
  for (let next = index + dir; next >= 0 && next < rows.length; next += dir) {
    if (usable(rows[next])) return rows[next]
  }
  return rows[index]
}

export interface NativePickerState {
  select: HTMLSelectElement
  title: string
  options: NativePickerOption[]
  /** Where focus goes back to when the chooser closes: the select as it was when it opened. */
  opener: FocusDescriptor | null
  /** Bumped on every open and refresh. */
  rev: number
}

const state = writable<NativePickerState | null>(null)
/** The open chooser, or null. Written only through the functions below. */
export const nativePicker: Readable<NativePickerState | null> = { subscribe: state.subscribe }

// Bumped on every open and close, so a focus return queued by one close can tell that the chooser
// opened (or closed) again before it ran.
let generation = 0

/** Open the chooser for `select`. False (nothing happens) unless isPickableSelect. Re-opening the same
 *  select keeps the original focus-return target. */
export function openNativePicker(select: HTMLSelectElement): boolean {
  if (!isPickableSelect(select)) return false
  const current = get(state)
  generation += 1
  state.set({
    select,
    title: pickerTitle(select),
    options: readSelectOptions(select),
    opener: current?.select === select ? current.opener : describeFocus(select),
    rev: (current?.rev ?? 0) + 1,
  })
  return true
}

/** Pad A's select branch (padActivate calls it first): off TV, a select isPickableSelect accepts
 *  opens the chooser and the press is consumed. TV keeps the native click, whose system dialog works
 *  there; every other element returns false so padActivate's own rules apply. */
export function padOpenPicker(el: Element | null | undefined): boolean {
  if (get(isTv) || !isPickableSelect(el)) return false
  return openNativePicker(el)
}

/** Re-read the open select's options (appended, removed, relabelled or disabled while open). A select
 *  that left the page or can no longer be driven (disabled, inert, under a modal dialog) closes the
 *  chooser without a focus return. */
export function refreshNativePicker(): void {
  const current = get(state)
  if (!current) return
  if (!current.select.isConnected || !isPickableSelect(current.select)) {
    closeNativePicker({ restore: false })
    return
  }
  state.set({
    ...current,
    title: pickerTitle(current.select),
    options: readSelectOptions(current.select),
    rev: current.rev + 1,
  })
}

// The select itself while it is still on the page; otherwise focus memory finds its replacement
// (a select re-rendered by its own change handler) by id, data-nav-id, label or nearest ancestor.
function returnFocus(closed: NativePickerState): void {
  const { select, opener } = closed
  if (select.isConnected && !select.closest('[inert]')) {
    select.focus({ preventScroll: true })
    if (document.activeElement === select) return
  }
  restoreFocus(opener)
}

/** Close the chooser. With restore (the default) focus returns to the select after Svelte's next
 *  flush (tick), unless the chooser opened again meanwhile or focus already moved to a real element
 *  outside the sheet. restore: false for a select that is gone, a navigation or a preemption. */
export function closeNativePicker(options: { restore?: boolean } = {}): void {
  const current = get(state)
  if (!current) return
  generation += 1
  const turn = generation
  state.set(null)
  if (options.restore === false) return
  void tick().then(() => {
    if (turn !== generation || get(state)) return
    const active = document.activeElement
    if (active && active !== document.body && active.isConnected && !active.closest('[data-native-picker]')) return
    returnFocus(current)
  })
}

/** A row was chosen: commit it exactly and close with a focus return. An option that vanished
 *  meanwhile re-reads the list instead and keeps the chooser open. */
export function chooseNativePickerOption(option: HTMLOptionElement): void {
  const current = get(state)
  if (!current) return
  if (commitPickerOption(current.select, option) === 'missing') {
    refreshNativePicker()
    return
  }
  closeNativePicker({ restore: true })
}

/** Watch the open select: its options (added, removed, relabelled, hidden, disabled, text edits) →
 *  onOptions; the select off the page or no longer isPickableSelect (disabled, aria-disabled, inert,
 *  a modal dialog opened) → onGone, once. A page observer only re-checks the "gone" conditions.
 *  Returns the disconnect function. */
export function watchControl(select: HTMLSelectElement, handlers: { onOptions: () => void; onGone: () => void }): () => void {
  let done = false
  const gone = () => {
    if (done) return true
    if (select.isConnected && isPickableSelect(select)) return false
    done = true
    handlers.onGone()
    return true
  }
  const own = new MutationObserver(() => { if (!gone()) handlers.onOptions() })
  own.observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'aria-disabled', 'label', 'hidden'] })
  const page = new MutationObserver(() => { gone() })
  page.observe(select.ownerDocument.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'inert', 'open'] })
  return () => {
    done = true
    own.disconnect()
    page.disconnect()
  }
}

const ROW_SELECTOR = '[data-picker-row]'

/** The sheet's rows in DOM order: the options, then Cancel. */
export function pickerRows(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(ROW_SELECTOR)]
}

function focusRow(row: HTMLElement): void {
  row.focus({ preventScroll: true })
  row.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
}

/** Focus the row of the current value, else the first usable row. Returns it (null: no rows). */
export function focusPickerRow(root: ParentNode): HTMLElement | null {
  const rows = pickerRows(root)
  const target = rows.find((row) => row.getAttribute('aria-selected') === 'true' && usable(row)) ?? stepPickerRow(rows, null, 1)
  if (target) focusRow(target)
  return target
}

/** The sheet's window-capture keydown. While the chooser is open (and the on-screen keyboard is not):
 *  every arrow is consumed here (preventDefault + stopImmediatePropagation, so nav/index.ts never
 *  sees it); Up/Down step the rows in DOM order through stepPickerRow, the same deterministic walk
 *  StreamPicker uses because WebKitGTK can leave focus behind snapshotted modals; Left/Right are
 *  swallowed. Other keys (Enter, Escape) pass. Returns whether it consumed the key. */
export function pickerKeydown(event: KeyboardEvent, root: ParentNode | null | undefined): boolean {
  if (!get(state) || get(oskOpen)) return false
  const dir = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
  if (!dir && event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return false
  if (!root) return false
  event.preventDefault()
  event.stopImmediatePropagation()
  if (!dir) return true
  const next = stepPickerRow(pickerRows(root), document.activeElement, dir)
  if (next && next !== document.activeElement) focusRow(next)
  return true
}

export function resetNativePickerForTests(): void {
  generation += 1
  state.set(null)
}
