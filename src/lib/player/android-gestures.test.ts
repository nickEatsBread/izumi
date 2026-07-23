import { describe, it, expect } from 'vitest'
import {
  zoneOf,
  classifyDrag,
  accumulateSeek,
  fullscreenPullProgress,
  shouldEnterFullscreen,
  shouldDismissSheet,
  landscapeExitProgress,
  shouldExitFullscreen,
} from './android-gestures'

describe('zoneOf', () => {
  it('splits the width into left/center/right thirds', () => {
    expect(zoneOf(10, 300)).toBe('l')
    expect(zoneOf(150, 300)).toBe('c')
    expect(zoneOf(290, 300)).toBe('r')
  })
})

describe('classifyDrag', () => {
  const s = { x: 150, y: 100, t: 0 }
  const W = 300, H = 300

  it('stays pending below the movement threshold', () => {
    expect(classifyDrag(s, { x: 155, y: 104, t: 1 }, W, H).kind).toBe('pending')
  })

  it('classifies dominant-horizontal travel as scrub', () => {
    expect(classifyDrag(s, { x: 200, y: 105, t: 1 }, W, H).kind).toBe('scrub')
  })

  it('ignores left-zone vertical travel (brightness gesture removed)', () => {
    const start = { x: 30, y: 150, t: 0 }
    expect(classifyDrag(start, { x: 32, y: 100, t: 1 }, W, H).kind).toBe('none')
  })

  it('ignores right-zone vertical travel (volume gesture removed)', () => {
    const start = { x: 280, y: 150, t: 0 }
    expect(classifyDrag(start, { x: 282, y: 100, t: 1 }, W, H).kind).toBe('none')
  })

  it('ignores center-zone vertical travel', () => {
    expect(classifyDrag(s, { x: 152, y: 40, t: 1 }, W, H).kind).toBe('none')
  })

  it('suppresses swipes that begin in the bottom control band', () => {
    const start = { x: 30, y: 290, t: 0 } // within bottomIgnore (96) of H=300
    expect(classifyDrag(start, { x: 32, y: 240, t: 1 }, W, H).kind).toBe('none')
  })
})

describe('accumulateSeek', () => {
  it('grows in the tapped direction', () => {
    expect(accumulateSeek(null, 'r', 10)).toEqual({ dir: 'r', amt: 10 })
    expect(accumulateSeek({ dir: 'r', amt: 10 }, 'r', 10)).toEqual({ dir: 'r', amt: 20 })
  })
  it('resets when the direction flips', () => {
    expect(accumulateSeek({ dir: 'r', amt: 20 }, 'l', 10)).toEqual({ dir: 'l', amt: 10 })
  })
})

describe('shouldDismissSheet', () => {
  it('dismisses a sheet after a substantial pull', () => {
    expect(shouldDismissSheet(120, 0.1, 800)).toBe(true)
  })

  it('dismisses a short, fast downward fling', () => {
    expect(shouldDismissSheet(30, 0.7, 800)).toBe(true)
  })

  it('snaps back after a short, slow pull', () => {
    expect(shouldDismissSheet(30, 0.1, 800)).toBe(false)
  })
})

describe('portrait fullscreen pull', () => {
  const top = 30
  const height = 360

  it('tracks an upward pull beginning in the lower half of the video', () => {
    const progress = fullscreenPullProgress(
      { x: 180, y: 300, t: 0 },
      { x: 184, y: 210, t: 100 },
      top,
      height,
    )
    expect(progress).toBeGreaterThan(0.4)
  })

  it('does not steal horizontal scrubs or pulls from the top of the video', () => {
    expect(fullscreenPullProgress(
      { x: 180, y: 300, t: 0 },
      { x: 260, y: 270, t: 100 },
      top,
      height,
    )).toBe(0)
    expect(fullscreenPullProgress(
      { x: 180, y: 100, t: 0 },
      { x: 180, y: 20, t: 100 },
      top,
      height,
    )).toBe(0)
  })

  it('commits a substantial pull or a fast upward fling', () => {
    expect(shouldEnterFullscreen(0.5, -0.1)).toBe(true)
    expect(shouldEnterFullscreen(0.2, -0.7)).toBe(true)
    expect(shouldEnterFullscreen(0.2, -0.1)).toBe(false)
  })
})

describe('landscape swipe-down exit', () => {
  const VH = 400

  it('tracks a downward drag through the fullscreen video', () => {
    const progress = landscapeExitProgress({ x: 400, y: 200, t: 0 }, { x: 404, y: 340, t: 100 }, VH)
    expect(progress).toBeGreaterThan(0.4)
  })

  it('ignores upward drags, horizontal scrubs, and top-edge starts', () => {
    // upward
    expect(landscapeExitProgress({ x: 400, y: 300, t: 0 }, { x: 400, y: 200, t: 100 }, VH)).toBe(0)
    // dominant-horizontal (a scrub)
    expect(landscapeExitProgress({ x: 200, y: 200, t: 0 }, { x: 320, y: 230, t: 100 }, VH)).toBe(0)
    // starts in the top safe band (system-bar swipe)
    expect(landscapeExitProgress({ x: 400, y: 10, t: 0 }, { x: 400, y: 200, t: 100 }, VH)).toBe(0)
  })

  it('commits a substantial pull or a fast downward fling', () => {
    expect(shouldExitFullscreen(0.5, 0.1)).toBe(true)
    expect(shouldExitFullscreen(0.1, 0.7)).toBe(true)
    expect(shouldExitFullscreen(0.1, 0.1)).toBe(false)
  })
})
