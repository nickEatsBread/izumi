import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const src = readFileSync(fileURLToPath(new URL('./gm-touch-watchdog.ts', import.meta.url)), 'utf8')

describe('Game-mode touch watchdog', () => {
  it('tracks only real touch pointers, not compatibility mouse events', () => {
    expect(src).toContain("if (e.pointerType !== 'touch') return")
  })

  it('provides a transition reset for releases swallowed by comments iframes', () => {
    expect(src).toContain("window.addEventListener('gm-touch-reset', reset)")
    expect(src).toContain("invoke('native_touch_hold', { held: false })")
    expect(src).toContain("invoke('restore_native_touch')")
  })
})
