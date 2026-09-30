// Whether the d-pad may land on an element. A leaf module (no nav imports) so the nav engine, the
// trap resolver, focus memory and the select chooser share one rule without importing each other
// (contract §2 import graph). Commit 4 lets roving tabs in; commit 6 excludes the closed keyboard.

/** Visible, in the tab order, not aria-hidden, not disabled (any form control, including through a
 *  disabled fieldset) and not inside an inert subtree (the Edit Home previews). jsdom and older
 *  WebKitGTK lack `checkVisibility`, and jsdom lacks `inert`, hence the optional call and the
 *  attribute walk instead of `el.inert`. */
export function isNavigable(el: HTMLElement): boolean {
  return (el.checkVisibility?.() ?? true)
    && el.tabIndex >= 0
    && el.getAttribute('aria-hidden') !== 'true'
    && !el.matches(':disabled')
    && !el.closest('[inert]')
}
