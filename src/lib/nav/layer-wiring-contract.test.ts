import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Commit 2 wiring that a unit test cannot mount: the nav engine's trap lookup, the controller
// translator's priority chain and PlayerOverlay's guards.
const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const count = (source: string, needle: string) => source.split(needle).length - 1
const between = (source: string, start: string, end: string) => {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  expect(from, start).toBeGreaterThanOrEqual(0)
  expect(to, end).toBeGreaterThan(from)
  return source.slice(from, to)
}

describe('nav engine trap resolution', () => {
  const index = read('./index.ts')

  it('asks the shared resolver for the trap and tries the focus hint first', () => {
    expect(index).toContain('const trap = activeNavTrap()')
    expect(index).not.toContain('[aria-label="On-screen keyboard"][data-nav-trap]')
    const fallback = between(index, 'const hinted = takeFocusHint(root)', 'const els = focusables(root)')
    expect(fallback).toContain('focusByNav(hinted, vertical, e.repeat)')
    expect(count(index, 'const els = focusables(root)')).toBe(2)
  })
})

describe('gamepad layer wiring', () => {
  const gamepad = read('./gamepad.ts')

  it('activates through padActivate everywhere, never a raw click', () => {
    expect(gamepad).not.toContain('activeElement as HTMLElement | null)?.click()')
    // The nine former click sites plus the new layer row.
    expect(count(gamepad, 'padActivate()')).toBe(10)
  })

  it('routes directions to the keyboard first and to a layer before the picker and the player', () => {
    const fireDir = between(gamepad, 'function fireDir(', 'function pressDir(')
    const deck = fireDir.indexOf('if (get(deckKeyboardWarning)) return')
    const osk = fireDir.indexOf('if (get(oskOpen)) { keydown(ARROW[dir], repeat); return }')
    const rating = fireDir.indexOf('if (get(seriesRatingPrompt))')
    const debrid = fireDir.indexOf('if (get(debridCaching)) return')
    const layer = fireDir.indexOf('if (topNavLayer()) { keydown(ARROW[dir], repeat); return }')
    const picker = fireDir.indexOf('const picker = get(streamPicker)')
    expect(deck).toBeGreaterThanOrEqual(0)
    expect(osk).toBeGreaterThan(deck)
    expect(rating).toBeGreaterThan(osk)
    expect(layer).toBeGreaterThan(debrid)
    expect(picker).toBeGreaterThan(layer)
  })

  it('orders onPress: warning, keyboard, pad owners, directions, layer, chain owners', () => {
    const onPress = between(gamepad, 'function onPress(', 'function onRelease(')
    const order = [
      'if (get(deckKeyboardWarning)) {',
      'if (get(oskOpen)) {',
      'if (get(trackMenuOpen)) return',
      'if (get(seriesRatingPrompt)) {',
      'if (DIRS.includes(name as Dir)) {',
      'if (topNavLayer()) {',
      'if (get(globalSearchOpen)) {',
    ].map((needle) => onPress.indexOf(needle))
    expect(order.every((position) => position >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(onPress).toContain("else if (name === 'b') closeTopNavLayer('back')")
    expect(onPress).toContain("!pickerUp && !topNavLayer() && (dir === 'left' || dir === 'right')) return")
  })

  it('lets the pad owners preempt layers and keeps the pinned legacy strings', () => {
    expect(gamepad).toContain("closeAllNavLayers('preempted')")
    expect(gamepad).toContain('[deckKeyboardWarning, trackMenuOpen, debridCaching, seriesRatingPrompt, exitPrompt]')
    expect(gamepad).toContain("document.querySelector('[data-nav-trap][data-nav-escape]')")
    expect(gamepad).toContain("case 'x': keydown('d')")
    expect(gamepad.indexOf('const onboarding = get(onboardingNav)')).toBeLessThan(gamepad.indexOf("case 'b':"))
  })
})

describe('PlayerOverlay layer wiring', () => {
  const overlay = read('../components/player/PlayerOverlay.svelte')

  it('never seeks or runs a hotkey under a layer', () => {
    expect(overlay).toContain('sourcePickerVisible || get(oskOpen) || !!topNavLayer(),')
    expect(overlay).toContain('layerOpen: !!topNavLayer()')
    expect(overlay).not.toContain('layerOpen: false')
  })

  it('leaves layer and keyboard buttons to the router', () => {
    const listener = between(overlay, "listenSafe<{ name: string; pressed: boolean }>('gamepad-input'", "if (e.payload.name === 'l4')")
    expect(listener).toContain("if (topNavLayer() || (get(oskOpen) && e.payload.name !== 'select')) return")
    expect(listener).toContain("if ((e.payload.name === 'a' || e.payload.name === 'b') && e.payload.pressed && performance.now() - get(navLayerDismissedAt) < 500) return")
    expect(overlay).not.toContain('activeElement as HTMLElement | null)?.click()')
    expect(overlay).toContain('padActivate()')
  })

  it('treats an open layer or keyboard as full-screen chrome', () => {
    expect(overlay).toContain('|| sourceConnectingVisible || $navLayerOpen || $oskOpen)')
  })
})
