import { listenSafe } from '$lib/util/listen'
import { BROWSER_GAMEPAD_EVENT } from './browser-gamepad'

export interface PadButton { name: string; pressed: boolean }

/** Controller button edges from both sources the browse translator hears: the native
 *  `gamepad-input` event (the Deck's reader, and browser pads re-emitted through Tauri) and the
 *  window event browser previews fall back to. Returns the unsubscribe function. */
export function onPadButton(handler: (input: PadButton) => void): () => void {
  const onWindow = (event: Event) => handler((event as CustomEvent<PadButton>).detail)
  window.addEventListener(BROWSER_GAMEPAD_EVENT, onWindow)
  const stopNative = '__TAURI_INTERNALS__' in window
    ? listenSafe<PadButton>('gamepad-input', (event) => handler(event.payload))
    : () => {}
  return () => {
    window.removeEventListener(BROWSER_GAMEPAD_EVENT, onWindow)
    stopNative()
  }
}
