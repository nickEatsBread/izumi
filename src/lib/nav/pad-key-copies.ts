import { get } from 'svelte/store'
import { gameMode } from '$lib/player/session'
import { onPadButton } from './pad-events'

/** Keys a Steam Input keyboard layout sends for controller buttons. */
const PAD_LIKE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'Backspace', 'Tab', ' '])
/** How long after a controller button a matching keyboard key still counts as its copy. */
export const PAD_KEY_COPY_MS = 250

/** Whether a keyboard event is Steam's copy of a controller button izumi has already handled. */
export function isPadKeyCopy(event: Pick<KeyboardEvent, 'isTrusted' | 'key'>, state: { gameMode: boolean; held: number; sincePadMs: number }): boolean {
  return event.isTrusted && PAD_LIKE_KEYS.has(event.key) && state.gameMode && (state.held > 0 || state.sincePadMs <= PAD_KEY_COPY_MS)
}

/** Steam Input can map the Deck's buttons to keyboard keys for a non-Steam game while izumi reads the
 *  controller itself, so each press arrived twice: izumi's own key, then Steam's 0-110 ms later. A
 *  d-pad step moved two places, and Start opened the drawer while Steam's key closed it. In Game mode
 *  such a key is dropped while a controller button is held and for a moment after; a keyboard used
 *  on its own is untouched. Registered in the capture phase before any other key listener.
 *  shortcut: a Steam key that arrives before izumi hears the button still gets through; none did in
 *  the Deck's input log, where the controller event always came first. */
export function dropPadKeyCopies(): () => void {
  const held = new Set<string>()
  let lastPadAt = -Infinity
  const stopPad = onPadButton((input) => {
    lastPadAt = performance.now()
    if (input.pressed) held.add(input.name)
    else held.delete(input.name)
  })
  const guard = (event: KeyboardEvent) => {
    if (!isPadKeyCopy(event, { gameMode: get(gameMode), held: held.size, sincePadMs: performance.now() - lastPadAt })) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  window.addEventListener('keydown', guard, true)
  window.addEventListener('keyup', guard, true)
  return () => {
    stopPad()
    window.removeEventListener('keydown', guard, true)
    window.removeEventListener('keyup', guard, true)
  }
}
