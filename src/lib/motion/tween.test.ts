// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { motionPreference } from '$lib/settings/ui'
import { FOCUS_MS, FOCUS_PROPERTY, IMAGE_FADE_MS, fadeOnLoad, trackFocusProgress } from './tween'

let queue: Array<(now: number) => void> = []
let clock = 0
const runFrames = (ms: number) => {
  const end = clock + ms
  while (clock < end && queue.length) {
    clock = Math.min(end, clock + 16)
    const due = queue
    queue = []
    for (const callback of due) callback(clock)
  }
}

beforeEach(() => {
  queue = []
  clock = 0
  vi.stubGlobal('requestAnimationFrame', (callback: (now: number) => void) => { queue.push(callback); return queue.length })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  motionPreference.set('system')
  document.body.replaceChildren()
})

describe('focus progress', () => {
  it('rises on the focused element and falls back on the one that lost focus', () => {
    const stop = trackFocusProgress()
    document.body.innerHTML = '<button data-focusable id="a"></button><button data-focusable id="b"></button><button id="c"></button>'
    const [a, b, c] = ['a', 'b', 'c'].map((id) => document.getElementById(id)!)
    a.focus()
    runFrames(FOCUS_MS / 2)
    const halfway = Number(a.style.getPropertyValue(FOCUS_PROPERTY))
    expect(halfway).toBeGreaterThan(0)
    expect(halfway).toBeLessThan(1)
    runFrames(FOCUS_MS)
    expect(a.style.getPropertyValue(FOCUS_PROPERTY)).toBe('1.000')
    b.focus()
    runFrames(FOCUS_MS * 2)
    expect(a.style.getPropertyValue(FOCUS_PROPERTY)).toBe('0.000')
    expect(b.style.getPropertyValue(FOCUS_PROPERTY)).toBe('1.000')
    // Only focusable controls carry it.
    c.focus()
    runFrames(FOCUS_MS * 2)
    expect(c.style.getPropertyValue(FOCUS_PROPERTY)).toBe('')
    stop()
  })

  it('jumps straight to the end with reduced motion', () => {
    motionPreference.set('reduce')
    const stop = trackFocusProgress()
    document.body.innerHTML = '<button data-focusable id="a"></button>'
    document.getElementById('a')!.focus()
    expect(document.getElementById('a')!.style.getPropertyValue(FOCUS_PROPERTY)).toBe('1.000')
    stop()
  })
})

describe('an image fading in as it loads', () => {
  it('starts hidden, fades to full and hands the opacity back to the stylesheet', () => {
    const image = document.createElement('img')
    fadeOnLoad(image)
    expect(image.style.opacity).toBe('0')
    image.dispatchEvent(new Event('load'))
    runFrames(IMAGE_FADE_MS / 2)
    expect(Number(image.style.opacity)).toBeGreaterThan(0)
    runFrames(IMAGE_FADE_MS)
    expect(image.style.opacity).toBe('')
  })

  it('leaves an image that already decoded alone', () => {
    const image = document.createElement('img')
    Object.defineProperty(image, 'complete', { value: true })
    Object.defineProperty(image, 'naturalWidth', { value: 320 })
    fadeOnLoad(image)
    expect(image.style.opacity).toBe('')
  })

  it('shows a broken image at once, for its fallback to take over', () => {
    const image = document.createElement('img')
    fadeOnLoad(image)
    image.dispatchEvent(new Event('error'))
    expect(image.style.opacity).toBe('')
  })
})
