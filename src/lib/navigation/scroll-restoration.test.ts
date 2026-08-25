import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { restoreScroll } from './scroll-restoration'

class TestWindow extends EventTarget {
  scrollTo = vi.fn()
}

let testWindow: TestWindow
let stored: string | null
let frames: FrameRequestCallback[]

const flushFrames = () => {
  while (frames.length) frames.shift()?.(0)
}

beforeEach(() => {
  testWindow = new TestWindow()
  stored = null
  frames = []
  vi.stubGlobal('window', testWindow)
  vi.stubGlobal('sessionStorage', { getItem: () => stored })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('scroll restoration', () => {
  it('restores a new route instantly instead of leaving a smooth scroll fighting a Deck swipe', () => {
    restoreScroll(new URL('https://izumi.test/app/home'))

    expect(testWindow.scrollTo).toHaveBeenCalledOnce()
    expect(testWindow.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' })
  })

  it('yields a delayed stored restoration when the user starts touching the page', () => {
    stored = '420'
    restoreScroll(new URL('https://izumi.test/app/browse'))
    testWindow.dispatchEvent(new Event('pointerdown'))
    flushFrames()

    expect(testWindow.scrollTo).not.toHaveBeenCalled()
  })

  it('cancels an older delayed restore when a new route wins', () => {
    stored = '420'
    restoreScroll(new URL('https://izumi.test/app/browse'))
    stored = null
    restoreScroll(new URL('https://izumi.test/app/schedule'))
    flushFrames()

    expect(testWindow.scrollTo).toHaveBeenCalledOnce()
    expect(testWindow.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' })
  })
})
