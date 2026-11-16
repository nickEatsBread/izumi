// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('focus under the controller', () => {
  afterEach(() => vi.restoreAllMocks())

  it('is a visible focus while the d-pad drives it, and left to the browser under a pointer', async () => {
    // WebKit only counts a script's focus() as :focus-visible after real key presses; a controller's
    // never reach it as keys, so themes' :focus-visible styles showed the plain white ring instead.
    const native = vi.spyOn(HTMLElement.prototype, 'focus')
    const { initInput, inputType } = await import('./input')
    initInput()
    const button = document.createElement('button')
    document.body.append(button)

    inputType.set('dpad')
    button.focus({ preventScroll: true })
    expect(native).toHaveBeenLastCalledWith({ focusVisible: true, preventScroll: true })
    button.focus({ focusVisible: false })
    expect(native).toHaveBeenLastCalledWith({ focusVisible: false })

    inputType.set('mouse')
    button.focus()
    expect(native).toHaveBeenLastCalledWith(undefined)
  })
})
