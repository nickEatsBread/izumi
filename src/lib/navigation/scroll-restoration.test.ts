import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetScroll, instantScrollUntil, restoreScroll } from './scroll-restoration'

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

  it('keeps the anchor scroll of a `#id` the page renders, even over a stored position', () => {
    stored = '420'
    vi.stubGlobal('document', { getElementById: (id: string) => (id === 'storage' ? {} : null) })
    restoreScroll(new URL('https://izumi.test/app/settings/downloads#storage'))
    flushFrames()

    expect(testWindow.scrollTo).not.toHaveBeenCalled()
  })

  it('still resets a page whose `#id` names nothing on it', () => {
    vi.stubGlobal('document', { getElementById: () => null })
    restoreScroll(new URL('https://izumi.test/app/settings/downloads#missing'))

    expect(testWindow.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' })
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

  it('restores a stored position in the navigation frame when the page is already long enough', () => {
    stored = '420'
    vi.stubGlobal('document', { documentElement: { scrollHeight: 2000 } })
    Object.assign(testWindow, { innerHeight: 640 })
    restoreScroll(new URL('https://izumi.test/app/browse'))

    expect(testWindow.scrollTo).toHaveBeenCalledWith({ top: 420, behavior: 'instant' })
    expect(frames).toHaveLength(0)
  })

  it('waits for a page still too short for its stored position', () => {
    stored = '1800'
    vi.stubGlobal('document', { documentElement: { scrollHeight: 1200 } })
    Object.assign(testWindow, { innerHeight: 640 })
    restoreScroll(new URL('https://izumi.test/app/browse'))
    expect(testWindow.scrollTo).not.toHaveBeenCalled()
    flushFrames()

    expect(testWindow.scrollTo).toHaveBeenCalledWith({ top: 1800, behavior: 'instant' })
  })

  it('keeps window scrolls instant until every overlapping navigation settles', async () => {
    const style = new Map<string, string>()
    const root = { style: {
      set scrollBehavior(value: string) { style.set('scroll-behavior', value) },
      removeProperty: (name: string) => { style.delete(name) },
    } }
    vi.stubGlobal('document', { documentElement: root })
    let finishFirst!: () => void
    let failSecond!: () => void
    instantScrollUntil(new Promise<void>((resolve) => { finishFirst = resolve }))
    instantScrollUntil(new Promise<void>((_, reject) => { failSecond = () => reject(new Error('aborted')) }))
    expect(style.get('scroll-behavior')).toBe('auto')
    failSecond()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(style.get('scroll-behavior')).toBe('auto')
    finishFirst()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(style.has('scroll-behavior')).toBe(false)
  })

  it('forgets a remembered position, so the next visit to that URL starts at the top', () => {
    const removeItem = vi.fn()
    vi.stubGlobal('sessionStorage', { getItem: () => stored, removeItem })
    forgetScroll(new URL('https://izumi.test/app/settings/subtitles?x=1'))

    expect(removeItem).toHaveBeenCalledWith('izumi-scroll:/app/settings/subtitles?x=1')
  })
})
