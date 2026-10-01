import { get } from 'svelte/store'
import { oskOpen } from '$lib/player/session'
import { topNavLayer } from './layers'

// Which trap owns the d-pad right now (spec §3.3). One answer for the nav engine, the chooser and
// the PIN keypad, instead of each guessing with its own querySelector. Precedence: the open
// on-screen keyboard, the top nav layer, an open modal <dialog>, then today's first visible trap.

/** The on-screen keyboard's root (OnScreenKeyboard.svelte marks it data-osk). */
export const OSK_ROOT_SELECTOR = '[data-osk][data-nav-trap]'

const shown = (el: Element) => el.checkVisibility?.() ?? true

/** The last open <dialog> matching `:modal`, else the last open one, else null. An engine that
 *  throws on `:modal` counts as "not modal". */
export function openModalDialog(root: Document = document): HTMLDialogElement | null {
  const open = [...root.querySelectorAll<HTMLDialogElement>('dialog[open]')]
  const modal = open.filter((dialog) => {
    try { return dialog.matches(':modal') } catch { return false }
  })
  return modal.at(-1) ?? open.at(-1) ?? null
}

/** Visible, non-inert `[data-nav-trap]` elements in DOM order. */
export function visibleNavTraps(root: ParentNode = document): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[data-nav-trap]')].filter((trap) => shown(trap) && !trap.closest('[inert]'))
}

export function activeNavTrap(): HTMLElement | null {
  const modal = openModalDialog()
  // 1. The keyboard sits above every dialog and layer, but a top-layer modal <dialog> it is not
  //    inside makes it unreachable, so it only counts inside that dialog.
  if (get(oskOpen)) {
    const keyboard = [...document.querySelectorAll<HTMLElement>(OSK_ROOT_SELECTOR)].find((root) => !root.closest('[inert]'))
    if (keyboard && (!modal || modal.contains(keyboard))) return keyboard
  }
  // 2. The top nav layer (a dropdown, sheet, chooser, the PIN keypad).
  const layer = topNavLayer()?.node()
  if (layer) return layer
  // 3. An open modal <dialog> (Nuvio, TrailerDialog) or the trap inside it.
  if (modal) return modal.querySelector<HTMLElement>('[data-nav-trap]') ?? modal
  // 4. Today's rule, minus hidden and fading traps.
  return visibleNavTraps()[0] ?? null
}

/** Dispatch a cancelable `cancel` on the dialog and close it unless a handler prevented that (a busy
 *  guard such as TrailerDialog's). True when it closed. */
export function cancelModalDialog(dialog: HTMLDialogElement): boolean {
  const proceed = dialog.dispatchEvent(new Event('cancel', { cancelable: true }))
  if (!proceed) return false
  dialog.close()
  return true
}
