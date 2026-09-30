// A lazy focus target (spec §3.9). When a layer closes under touch or the mouse, moving focus would
// paint a ring nobody asked for (a Deck tap arrives as a mouse click), so the layer leaves its opener
// here instead. The nav engine's body fallback takes it on the next d-pad press, which then lands
// back on the opener rather than on the page's first control. No imports at all, so nav/index.ts,
// overlay.ts and the chooser can all share it without an import cycle.

let hint: HTMLElement | null = null

export function setFocusHint(el: HTMLElement | null): void {
  hint = el
}

/** Returns and clears the hint if it is connected, inside `root` (default: its document), not
 *  `:disabled` and not inside `[inert]`; otherwise clears it and returns null. */
export function takeFocusHint(root?: ParentNode): HTMLElement | null {
  const el = hint
  hint = null
  if (!el || !el.isConnected) return null
  const scope = root ?? el.ownerDocument
  if (scope !== el && !(scope as Node).contains(el)) return null
  if (el.matches(':disabled') || el.closest('[inert]')) return null
  return el
}

export function peekFocusHint(): HTMLElement | null {
  return hint
}
