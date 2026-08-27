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

  it('does not fake-release or warp an ordinary completed swipe', () => {
    const clear = src.slice(src.indexOf('const clear ='), src.indexOf('const got ='))
    expect(clear).toContain('if (!active.size) setHold(false)')
    expect(clear).not.toContain("invoke('gm_touch_unstick')")
  })

  it('aborts a pending controller scroll outside playback without flushing hidden Home during playback', () => {
    const down = src.slice(src.indexOf('const down ='), src.indexOf('const move ='))
    expect(down).toContain("behavior: 'instant'")
    expect(down).toContain('e.composedPath()')
    expect(down).toContain("target.classList.contains('izumi-player-root')")
    expect(down).toContain('if (!inPlayer)')
  })

  it('gives transient focus wobbles a quiet window before recovery', () => {
    expect(src).toContain('const FOCUS_RECOVERY_MS = 600')
    expect(src).toContain("recover(id, pointer, 'focus-return')")
    expect(src).toContain('pointer.lastAt <= returnedAt')
    expect(src).not.toContain('const returned = () => {\n    reset()')
  })

  it('provides a transition reset for releases swallowed by comments iframes', () => {
    expect(src).toContain("window.addEventListener('gm-touch-reset', reset)")
    expect(src).toContain("invoke('native_touch_hold', { held: false })")
    expect(src).toContain("invoke('restore_native_touch')")
    expect(src).not.toContain('requestAnimationFrame(restore)')
  })
})
