import { tick } from 'svelte'

/** A Home editor Move up/down press (HomeRowFrame). Both buttons stay focusable at either end
 *  (aria-disabled, not disabled): a button that disables itself under the d-pad drops focus to
 *  <body>, so an aria-disabled press does nothing here instead. The keyed row move can re-insert
 *  the row, which blurs the pressed button, so when it held focus, focus goes back to the same
 *  button (`data-row-move`) of the moved row (`data-home-row`) once Svelte has applied the move. */
export async function moveRowKeepingFocus(button: HTMLElement, rowId: string, move: () => void): Promise<void> {
  if (button.getAttribute('aria-disabled') === 'true') return
  const hadFocus = document.activeElement === button
  move()
  if (!hadFocus) return
  await tick()
  const again = document.querySelector<HTMLElement>(`[data-home-row="${CSS.escape(rowId)}"] [data-row-move="${button.dataset.rowMove}"]`)
  again?.focus({ preventScroll: true })
  again?.scrollIntoView?.({ block: 'nearest' })
}
