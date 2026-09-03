import { describe, expect, it } from 'vitest'
import { readBrowserGamepadState, type GamepadInputState } from './browser-gamepad'

const buttons = () => Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }))
const state = (overrides: Partial<GamepadInputState> = {}) => ({
  a: false, b: false, x: false, y: false,
  l1: false, r1: false, l2: false, r2: false,
  select: false, start: false, l3: false, r3: false,
  up: false, down: false, left: false, right: false,
  ...overrides,
})

describe('browser Standard Gamepad mapping', () => {
  it('maps face buttons, bumpers, triggers and the D-pad', () => {
    const padButtons = buttons()
    padButtons[0] = { pressed: true, value: 1 }
    padButtons[5] = { pressed: true, value: 1 }
    padButtons[6] = { pressed: false, value: 0.4 }
    padButtons[12] = { pressed: true, value: 1 }
    const result = readBrowserGamepadState({ buttons: padButtons, axes: [0, 0], connected: true })
    expect(result).toMatchObject({ a: true, r1: true, l2: true, up: true })
  })

  it('turns the left stick into directions with a dead zone and release hysteresis', () => {
    expect(readBrowserGamepadState({ buttons: buttons(), axes: [0.5, 0], connected: true }).right).toBe(false)
    expect(readBrowserGamepadState({ buttons: buttons(), axes: [0.8, -0.7], connected: true })).toMatchObject({ right: true, up: true })
    expect(readBrowserGamepadState(
      { buttons: buttons(), axes: [0.4, 0], connected: true },
      state({ right: true }),
    ).right).toBe(true)
    expect(readBrowserGamepadState(
      { buttons: buttons(), axes: [0.2, 0], connected: true },
      state({ right: true }),
    ).right).toBe(false)
  })
})
