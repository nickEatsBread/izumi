import { describe, expect, it } from 'vitest'
import {
  DOCK_SPRING, miniDetailsShift, miniDismissOutcome, miniDockGeometry, miniPullOutcome, miniPullProgress,
  miniPullTransform, miniPullTravel, releaseVelocity, springSettled, stepSpring, velocityToProgress,
} from './mini-player'
import { MOVE_PX } from './android-gestures'

// A 412×915 CSS px phone in portrait, 24px status bar, 16:9 video band.
const viewport = { width: 412, height: 915 }
const source = { left: 0, top: 24, width: 412, height: 232 }
const target = miniDockGeometry(viewport, 0)

describe('dock geometry', () => {
  it('is a 16:9 thumbnail flush left, directly above the bottom navigation', () => {
    expect(target).toEqual({ left: 0, top: 915 - 64 - 64, width: 114, height: 64 })
  })

  it('rises with the safe-area inset the navigation bar itself is padded by', () => {
    expect(miniDockGeometry(viewport, 24).top).toBe(target.top - 24)
  })
})

describe('direct manipulation', () => {
  const travel = miniPullTravel(source, target)

  it('maps the full trip of the video centre to progress 1, so the sheet follows the finger 1:1', () => {
    // Centre travels from 24+116 to (915-128)+32.
    expect(travel).toBe((787 + 32) - 140)
    expect(miniPullProgress(MOVE_PX + travel, travel)).toBe(1)
    expect(miniPullProgress(MOVE_PX + travel / 2, travel)).toBeCloseTo(0.5)
  })

  it('starts from zero at recognition instead of jumping the slop distance', () => {
    expect(miniPullProgress(MOVE_PX, travel)).toBe(0)
    expect(miniPullProgress(MOVE_PX + 1, travel)).toBeCloseTo(1 / travel)
    expect(miniPullProgress(-40, travel)).toBe(0)
  })

  it('lands exactly on the dock rectangle at progress 1 and stays put at 0', () => {
    expect(miniPullTransform(0, source, target)).toEqual({ scale: 1, tx: 0, ty: 0 })
    const end = miniPullTransform(1, source, target)
    expect(end.scale).toBeCloseTo(114 / 412)
    // Centre-pivot scale + translate → the video's rect equals the dock.
    const width = source.width * end.scale
    const left = source.left + source.width / 2 + end.tx - width / 2
    const top = source.top + source.height / 2 + end.ty - (source.height * end.scale) / 2
    // The resting band is rounded to whole CSS px and the thumb to 64×114, so the two 16:9 rects
    // differ by a fraction of a pixel; the hand-over to the docked layout is sub-pixel.
    expect(left).toBeCloseTo(target.left, 0)
    expect(top).toBeCloseTo(target.top, 0)
    expect(width).toBeCloseTo(target.width, 0)
  })

  it('moves the video centre linearly with progress', () => {
    const half = miniPullTransform(0.5, source, target)
    expect(half.ty).toBeCloseTo(travel / 2)
    expect(half.scale).toBeCloseTo(1 + (114 / 412 - 1) / 2)
  })

  it('carries the watch page down with the video’s bottom edge', () => {
    expect(miniDetailsShift(0, source, target)).toBe(0)
    const quarter = miniDetailsShift(0.25, source, target)
    expect(quarter).toBeGreaterThan(0)
    expect(miniDetailsShift(0.5, source, target)).toBeGreaterThan(quarter)
  })
})

describe('release decisions', () => {
  it('docks on a downward fling however short the drag, and restores on an upward one', () => {
    expect(miniPullOutcome(0.05, 0.6)).toBe('dock')
    expect(miniPullOutcome(0.9, -0.6)).toBe('restore')
  })

  it('commits a slow release past about a third of the trip', () => {
    expect(miniPullOutcome(0.34, 0)).toBe('restore')
    expect(miniPullOutcome(0.36, 0)).toBe('dock')
  })

  it('ignores a stale fling: resting the finger before lifting is not a throw', () => {
    expect(releaseVelocity(1.2, 30)).toBe(1.2)
    expect(releaseVelocity(1.2, 250)).toBe(0)
  })

  it('closes the docked bar on a deliberate pull or fling and keeps it otherwise', () => {
    expect(miniDismissOutcome(40, 0)).toBe('close')
    expect(miniDismissOutcome(10, 0.5)).toBe('close')
    expect(miniDismissOutcome(20, 0)).toBe('keep')
    expect(miniDismissOutcome(50, -0.3)).toBe('keep')
  })

  it('converts finger speed into the spring’s progress units', () => {
    expect(velocityToProgress(0.68, 680)).toBeCloseTo(1)
  })
})

describe('dock spring', () => {
  const run = (from: number, to: number, v0: number) => {
    let s = { x: from, v: v0 }
    let ms = 0
    let overshoot = 0
    while (!springSettled(s, to) && ms < 2000) {
      s = stepSpring(s, to, 16.7)
      ms += 16.7
      overshoot = Math.max(overshoot, to === 1 ? s.x - 1 : -s.x)
    }
    return { s, ms, overshoot }
  }

  it('settles from rest in roughly a third of a second with no visible bounce', () => {
    const { s, ms, overshoot } = run(0.4, 1, 0)
    expect(s.x).toBeCloseTo(1, 2)
    expect(ms).toBeGreaterThan(150)
    expect(ms).toBeLessThan(500)
    expect(overshoot).toBeLessThan(0.02)
  })

  it('arrives sooner when thrown, and never explodes on a dropped frame', () => {
    const thrown = run(0.4, 1, 6)
    const dropped = run(0.4, 1, 0)
    expect(thrown.ms).toBeLessThan(dropped.ms)
    let s = { x: 0, v: 0 }
    for (let i = 0; i < 20; i++) s = stepSpring(s, 1, 500) // 500ms frames
    expect(s.x).toBeGreaterThan(0.9)
    expect(s.x).toBeLessThan(1.1)
  })

  it('is tuned just under critical damping', () => {
    const critical = 2 * Math.sqrt(DOCK_SPRING.stiffness)
    expect(DOCK_SPRING.damping).toBeLessThan(critical)
    expect(DOCK_SPRING.damping).toBeGreaterThan(critical * 0.9)
  })
})
