// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { BROWSER_GAMEPAD_EVENT } from './browser-gamepad'
import { onPadButton } from './pad-events'

describe('onPadButton', () => {
  it('hears the browser pad event until unsubscribed', () => {
    const handler = vi.fn()
    const stop = onPadButton(handler)
    window.dispatchEvent(new CustomEvent(BROWSER_GAMEPAD_EVENT, { detail: { name: 'l1', pressed: true } }))
    expect(handler).toHaveBeenCalledWith({ name: 'l1', pressed: true })
    stop()
    window.dispatchEvent(new CustomEvent(BROWSER_GAMEPAD_EVENT, { detail: { name: 'r1', pressed: true } }))
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
