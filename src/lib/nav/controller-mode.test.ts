import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const layout = read('../../routes/app/+layout.svelte')
const css = read('../../app.css')
const input = read('./input.ts')
const gamepad = read('./browser-gamepad.ts')
const overlay = read('../components/player/PlayerOverlay.svelte')

describe('automatic controller mode', () => {
  it('activates only on real controller input and restores pointer mode on mouse movement', () => {
    expect(gamepad).toContain('if (pressed) useControllerInput()')
    expect(gamepad).not.toContain("controllerMode.set(true)\n  window.addEventListener('gamepadconnected'")
    expect(input).toContain("window.addEventListener('pointermove'")
    expect(input).toContain('if (event.isTrusted) leaveControllerMode()')
  })

  it('uses the existing navigation and player input paths without enabling Gamescope', () => {
    expect(layout).toContain('const stopBrowserGamepad = startBrowserGamepadInput()')
    expect(layout).toContain("classList.toggle('controller-mode', $controllerMode && !$gameMode && !$isTv)")
    expect(css).toContain('.controller-mode [data-focusable]:focus')
    expect(overlay).toContain('const controllerInputMode = $derived(gmMode || $controllerMode)')
    expect(overlay).toContain('if (!controllerInputMode || !$playing) return')
  })
})
