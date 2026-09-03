import { emit } from '@tauri-apps/api/event'
import { get } from 'svelte/store'
import { gameMode } from '$lib/player/session'
import { controllerMode, useControllerInput } from './input'

export type GamepadInputName =
  | 'a' | 'b' | 'x' | 'y'
  | 'l1' | 'r1' | 'l2' | 'r2'
  | 'select' | 'start' | 'l3' | 'r3'
  | 'up' | 'down' | 'left' | 'right'

export type GamepadInputState = Record<GamepadInputName, boolean>

type ButtonLike = Pick<GamepadButton, 'pressed' | 'value'>
type GamepadLike = {
  axes: readonly number[]
  buttons: readonly ButtonLike[]
  connected: boolean
}

export const BROWSER_GAMEPAD_EVENT = 'izumi-browser-gamepad-input'
const PRESS_THRESHOLD = 0.55
const RELEASE_THRESHOLD = 0.35
const TRIGGER_THRESHOLD = 0.3

const BUTTONS: Partial<Record<number, GamepadInputName>> = {
  0: 'a', 1: 'b', 2: 'x', 3: 'y',
  4: 'l1', 5: 'r1', 6: 'l2', 7: 'r2',
  8: 'select', 9: 'start', 10: 'l3', 11: 'r3',
  12: 'up', 13: 'down', 14: 'left', 15: 'right',
}

const NAMES = Object.values(BUTTONS) as GamepadInputName[]

function emptyState(): GamepadInputState {
  return Object.fromEntries(NAMES.map((name) => [name, false])) as GamepadInputState
}

function buttonPressed(button: ButtonLike | undefined, trigger = false): boolean {
  return !!button && (button.pressed || button.value > (trigger ? TRIGGER_THRESHOLD : 0.5))
}

function axisPressed(value: number, direction: -1 | 1, held: boolean): boolean {
  const amount = value * direction
  return amount >= (held ? RELEASE_THRESHOLD : PRESS_THRESHOLD)
}

/** Read the browser's Standard Gamepad mapping. Stick directions and D-pad buttons are merged, and
 * hysteresis prevents slightly noisy analogue sticks from chattering between press/release. */
export function readBrowserGamepadState(
  pad: GamepadLike,
  previous: GamepadInputState = emptyState(),
): GamepadInputState {
  const state = emptyState()
  for (const [rawIndex, name] of Object.entries(BUTTONS)) {
    const index = Number(rawIndex)
    state[name!] = buttonPressed(pad.buttons[index], index === 6 || index === 7)
  }
  const x = Number.isFinite(pad.axes[0]) ? pad.axes[0] : 0
  const y = Number.isFinite(pad.axes[1]) ? pad.axes[1] : 0
  state.left ||= axisPressed(x, -1, previous.left)
  state.right ||= axisPressed(x, 1, previous.right)
  state.up ||= axisPressed(y, -1, previous.up)
  state.down ||= axisPressed(y, 1, previous.down)
  return state
}

function visibleGamepads(): Gamepad[] {
  try {
    return [...(navigator.getGamepads?.() ?? [])].filter((pad): pad is Gamepad => !!pad?.connected)
  } catch {
    // Permissions Policy or a webview without Gamepad support: native Deck input still works.
    return []
  }
}

/** Poll a paired browser-visible controller and publish only logical button edges into the existing
 * Tauri `gamepad-input` bus. Browsers expose an already-paired pad after its first user gesture. */
export function startBrowserGamepadInput(): () => void {
  if (typeof window === 'undefined' || !navigator.getGamepads) return () => {}

  let frame = 0
  let previous = emptyState()
  let running = false
  let disposed = false

  const publish = (name: GamepadInputName, pressed: boolean) => {
    if (pressed) useControllerInput()
    const payload = { name, pressed }
    void emit('gamepad-input', payload).catch(() => {
      window.dispatchEvent(new CustomEvent(BROWSER_GAMEPAD_EVENT, { detail: payload }))
    })
  }

  const releaseAll = () => {
    for (const name of NAMES) if (previous[name]) publish(name, false)
    previous = emptyState()
  }

  const loop = () => {
    if (disposed || get(gameMode)) { running = false; return }
    const pad = visibleGamepads()[0]
    if (!pad) {
      releaseAll()
      controllerMode.set(false)
      running = false
      return
    }
    const current = readBrowserGamepadState(pad, previous)
    for (const name of NAMES) {
      if (current[name] !== previous[name]) publish(name, current[name])
    }
    previous = current
    frame = requestAnimationFrame(loop)
  }

  const ensurePolling = () => {
    if (disposed || running || get(gameMode)) return
    running = true
    frame = requestAnimationFrame(loop)
  }
  const onDisconnected = () => {
    if (!visibleGamepads().length) {
      releaseAll()
      controllerMode.set(false)
    }
  }
  const onVisibility = () => {
    if (document.hidden) releaseAll()
    else ensurePolling()
  }

  window.addEventListener('gamepadconnected', ensurePolling)
  window.addEventListener('gamepaddisconnected', onDisconnected)
  document.addEventListener('visibilitychange', onVisibility)
  if (visibleGamepads().length) ensurePolling()

  return () => {
    disposed = true
    running = false
    cancelAnimationFrame(frame)
    releaseAll()
    window.removeEventListener('gamepadconnected', ensurePolling)
    window.removeEventListener('gamepaddisconnected', onDisconnected)
    document.removeEventListener('visibilitychange', onVisibility)
    controllerMode.set(false)
  }
}
