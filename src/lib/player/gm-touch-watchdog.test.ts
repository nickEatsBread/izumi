import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const src = readFileSync(fileURLToPath(new URL('./gm-touch-watchdog.ts', import.meta.url)), 'utf8')

describe('Game-mode touch watchdog', () => {
  it('tracks every pointer type — Deck WebKitGTK synthesizes touch as mouse pointers', () => {
    // The old `pointerType !== 'touch'` filter made the watchdog inert on the shipped Deck
    // runtime (WebKitGTK 2.48-2.50 has no touch pointer events at all). Guard the regression.
    expect(src).not.toContain("e.pointerType !== 'touch'")
  })

  it('escalates recovery to the X-level unstick (WebKit-internal state is out of JS reach)', () => {
    expect(src).toContain("invoke('gm_touch_unstick')")
    expect(src).toContain("window.addEventListener('focus', returned)")
  })

  it('unsticks the synthesized pointer when the last finger lifts', () => {
    expect(src).toContain('if (!active.size)')
    expect(src).toContain("invoke('gm_touch_unstick')")
  })

  it('provides a transition reset for releases swallowed by comments iframes', () => {
    expect(src).toContain("window.addEventListener('gm-touch-reset', reset)")
    expect(src).toContain("invoke('native_touch_hold', { held: false })")
    expect(src).toContain("invoke('restore_native_touch')")
    expect(src).not.toContain('requestAnimationFrame(restore)')
  })
})
