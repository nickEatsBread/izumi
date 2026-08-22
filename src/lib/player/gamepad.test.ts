import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ButtonPressLatch, TriggerScrubber, SEEK } from './gamepad'

function deps(pos = 100, dur = 1000) {
  return {
    getPos: () => pos,
    getDur: () => dur,
    seek: vi.fn(),
    beginScrub: vi.fn(),
    moveScrub: vi.fn(),
    endScrub: vi.fn(),
    onActivity: vi.fn(),
  }
}

describe('TriggerScrubber', () => {
  it('a quick tap forward seeks by SEEK.tap seconds (clamped)', () => {
    const d = deps(100, 1000)
    const s = new TriggerScrubber(+1, d)
    s.update(true, 0)
    s.update(false, 100)
    expect(d.seek).toHaveBeenCalledWith(110)
    expect(d.beginScrub).not.toHaveBeenCalled()
    expect(d.onActivity).toHaveBeenCalledTimes(1)
  })

  it('a quick tap backward is clamped at 0', () => {
    const d = deps(5, 1000)
    const s = new TriggerScrubber(-1, d)
    s.update(true, 0)
    s.update(false, 100)
    expect(d.seek).toHaveBeenCalledWith(0)
  })

  it('holding enters a preview scrub and advances by STEP, committing on release', () => {
    const d = deps(100, 1000)
    const s = new TriggerScrubber(+1, d)
    s.update(true, 0)
    s.update(true, SEEK.initialDelay)
    expect(d.beginScrub).toHaveBeenCalledWith(100)
    expect(d.moveScrub).toHaveBeenLastCalledWith(100 + SEEK.step)
    s.update(false, SEEK.initialDelay + 40)
    expect(d.endScrub).toHaveBeenCalledTimes(1)
    expect(d.seek).not.toHaveBeenCalled()
  })

  it('preview is clamped to [0, dur]', () => {
    const d = deps(995, 1000)
    const s = new TriggerScrubber(+1, d)
    s.update(true, 0)
    s.update(true, SEEK.initialDelay)
    expect(d.moveScrub).toHaveBeenLastCalledWith(1000)
  })

  it('does not clamp to zero while duration is still unknown', () => {
    const d = deps(100, 0)
    const s = new TriggerScrubber(+1, d)
    s.update(true, 0)
    s.update(false, 100)
    expect(d.seek).toHaveBeenCalledWith(110)
  })

  it('updates a digital d-pad tap on press instead of waiting for release', () => {
    const d = deps(100, 1000)
    const s = new TriggerScrubber(+1, d, true)
    s.update(true, 0)
    expect(d.seek).toHaveBeenCalledWith(110)
    s.update(false, 80)
    expect(d.seek).toHaveBeenCalledTimes(1)
  })
})

describe('ButtonPressLatch', () => {
  it('accepts one press until release and ignores a duplicated pressed edge', () => {
    const latch = new ButtonPressLatch()
    expect(latch.update(true, 1000)).toBe(true)
    expect(latch.update(true, 1001)).toBe(false)
    expect(latch.update(false, 1010)).toBe(false)
  })

  it('ignores a release/press bounce but accepts the next deliberate press', () => {
    const latch = new ButtonPressLatch(350)
    expect(latch.update(true, 1000)).toBe(true)
    latch.update(false, 1010)
    expect(latch.update(true, 1020)).toBe(false)
    latch.update(false, 1030)
    expect(latch.update(true, 1400)).toBe(true)
  })
})

describe('native Game-mode seek', () => {
  it('skims with d-pad left/right as well as the triggers', () => {
    const src = readFileSync(fileURLToPath(new URL('./gamepad.ts', import.meta.url)), 'utf8')
    expect(src).toContain("e.payload.name === 'left'")
    expect(src).toContain("e.payload.name === 'right'")
    expect(src).toContain('blocked')
  })
})

describe('Steam Deck rear grips', () => {
  it('maps L4 to screenshot and R4 to GIF in Game mode', () => {
    const native = readFileSync(fileURLToPath(new URL('../../../src-tauri/src/player/gamepad_linux.rs', import.meta.url)), 'utf8')
    const overlay = readFileSync(fileURLToPath(new URL('../components/player/PlayerOverlay.svelte', import.meta.url)), 'utf8')
    expect(native).toContain('"l4"')
    expect(native).toContain('"r4"')
    expect(overlay).toContain("e.payload.name === 'l4'")
    expect(overlay).toContain("e.payload.name === 'r4'")
    expect(overlay).toContain('playerScreenshot()')
    expect(overlay).toContain("void capture('gif')")
  })
})
