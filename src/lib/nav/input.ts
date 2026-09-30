import { get, writable } from 'svelte/store'
export const inputType = writable<'mouse' | 'touch' | 'dpad'>('mouse')

/** Active input modality for ordinary desktop/mobile clients. Steam Deck Gamescope remains owned
 * by `gameMode`; this store deliberately changes only controller navigation and presentation. */
export const controllerMode = writable(false)

export function useControllerInput() {
  controllerMode.set(true)
  inputType.set('dpad')
}

function leaveControllerMode() {
  if (get(controllerMode)) controllerMode.set(false)
}

export function initInput() {
  const usePointer = (event: PointerEvent) => {
    // A touch on the built-in keyboard is still the controller session that opened it (Game-mode
    // touch, a phone with a pad): keep controller mode so the rings and prompts stay. A mouse on the
    // keys does leave it, so the cursor app.css hides in controller mode comes back.
    if (event.pointerType === 'touch' && event.target instanceof Element && event.target.closest('[data-osk]')) return
    leaveControllerMode()
    inputType.set(event.pointerType === 'touch' ? 'touch' : 'mouse')
  }
  // Moving a real mouse must restore its cursor without requiring a click. Touch has no hover, so
  // pointerdown is its modality edge. Gamescope remains in its native gameMode either way.
  window.addEventListener('pointermove', (event) => { if (event.pointerType === 'mouse') usePointer(event) }, { passive: true })
  window.addEventListener('pointerdown', usePointer, { passive: true })
  window.addEventListener('keydown', event => {
    // Controller-generated arrows are synthetic and must not immediately undo controller mode.
    if (event.isTrusted) leaveControllerMode()
    if (event.key.startsWith('Arrow')) inputType.set('dpad')
  })
}
