// Game mode: WebKitGTK restyles far more than it needs to when focus moves under rules that use
// `:focus`, `:focus-within` or `:is(:focus, …)`. Measured on the Deck with a TV theme, one D-pad move
// spent 35 ms in style alone, a single `:is(:focus, :focus-within)` rule 18 ms of it, on a page that
// had no element it could match. Attribute changes are invalidated precisely, so in Game mode the
// theme stylesheet reads focus from attributes the host keeps on the focus path instead
// (themes/css.ts mirrorFocusSelectors): `data-izumi-focus` on the focused element,
// `data-izumi-focus-within` on it and every ancestor, and `data-izumi-has-focus` tokens for the
// compounds a `:has()` argument watches. Only the elements whose state changes are touched.

import type { FocusWatch } from './css'

export const FOCUS_ATTRIBUTE = 'data-izumi-focus'
export const FOCUS_WITHIN_ATTRIBUTE = 'data-izumi-focus-within'
export const HAS_FOCUS_ATTRIBUTE = 'data-izumi-has-focus'

let watches: FocusWatch[] = []
let resync: (() => void) | null = null

/** The `:has()` compounds of the theme stylesheet in force (an empty list for none). */
export function setFocusWatches(next: FocusWatch[]): void {
  watches = next
  resync?.()
}

/** The elements that match `:focus-within` for `active`, innermost first; none while nothing has focus. */
export function focusPath(active: Element | null, doc: Document = document): Element[] {
  const path: Element[] = []
  if (!active || active === doc.body || active === doc.documentElement) return path
  for (let node: Element | null = active; node; node = node.parentElement) path.push(node)
  return path
}

const matches = (node: Element, selector: string) => {
  try {
    return node.matches(selector)
  } catch {
    return false
  }
}

/** The `data-izumi-has-focus` tokens `node` carries for the focus path `path`. */
export function hasFocusTokens(node: Element, path: readonly Element[], list: readonly FocusWatch[] = watches): string {
  return list
    .filter((watch) => (watch.kind === 'within' || node === path[0]) && matches(node, watch.selector))
    .map((watch) => watch.token)
    .join(' ')
}

/** Keep the focus attributes in step with the document's focus. Returns the stop function. */
export function startFocusMirror(doc: Document = document): () => void {
  let path: Element[] = []
  const tokens = new Map<Element, string>()
  const sync = (force = false) => {
    const next = focusPath(doc.activeElement, doc)
    const keep = new Set(next)
    for (const node of path) {
      if (keep.has(node)) continue
      node.removeAttribute(FOCUS_WITHIN_ATTRIBUTE)
      node.removeAttribute(HAS_FOCUS_ATTRIBUTE)
      tokens.delete(node)
    }
    const had = new Set(path)
    for (const node of next) {
      if (!had.has(node)) node.setAttribute(FOCUS_WITHIN_ATTRIBUTE, '')
      // The focused element's tokens differ from its ancestors' (`focus` watches), so the old and new
      // focused elements are recomputed too, as is everything after the watch list changes.
      if (force || !had.has(node) || node === next[0] || node === path[0]) {
        const value = hasFocusTokens(node, next)
        if (value !== (tokens.get(node) ?? '')) {
          if (value) node.setAttribute(HAS_FOCUS_ATTRIBUTE, value)
          else node.removeAttribute(HAS_FOCUS_ATTRIBUTE)
          tokens.set(node, value)
        }
      }
    }
    if (path[0] !== next[0]) {
      path[0]?.removeAttribute(FOCUS_ATTRIBUTE)
      next[0]?.setAttribute(FOCUS_ATTRIBUTE, '')
    }
    path = next
  }
  // focusin lands after focus has moved; a blur to nothing only raises focusout, before activeElement
  // settles, so that case syncs once the event is done.
  const onFocusIn = () => sync()
  const onFocusOut = () => queueMicrotask(() => sync())
  doc.addEventListener('focusin', onFocusIn, true)
  doc.addEventListener('focusout', onFocusOut, true)
  resync = () => sync(true)
  sync(true)
  return () => {
    doc.removeEventListener('focusin', onFocusIn, true)
    doc.removeEventListener('focusout', onFocusOut, true)
    if (resync) resync = null
    for (const node of path) {
      node.removeAttribute(FOCUS_ATTRIBUTE)
      node.removeAttribute(FOCUS_WITHIN_ATTRIBUTE)
      node.removeAttribute(HAS_FOCUS_ATTRIBUTE)
    }
    path = []
    tokens.clear()
  }
}
