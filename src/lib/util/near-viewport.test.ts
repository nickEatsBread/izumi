import { afterEach, describe, expect, it, vi } from 'vitest'
import { isNearViewport, offscreenDistance } from './near-viewport'

describe('near viewport threshold', () => {
  it('activates visible and one-and-a-half-screen-ahead rows', () => {
    expect(isNearViewport(-100, 800)).toBe(true)
    expect(isNearViewport(800, 800)).toBe(true)
    expect(isNearViewport(1199, 800)).toBe(true)
    expect(isNearViewport(1200, 800)).toBe(false)
  })

  it('supports a caller-specific lookahead and invalid geometry', () => {
    expect(isNearViewport(1599, 800, 2)).toBe(true)
    expect(isNearViewport(1600, 800, 2)).toBe(false)
    expect(isNearViewport(Number.NaN, 800)).toBe(false)
  })
})

describe('nearViewport action', () => {
  afterEach(() => vi.unstubAllGlobals())

  // The util keeps module-level state, so every test gets a fresh copy plus fresh browser stubs.
  async function setup() {
    vi.resetModules()
    const window = { innerHeight: 800, addEventListener: vi.fn(), removeEventListener: vi.fn() }
    let frames: (() => void)[] = []
    vi.stubGlobal('window', window)
    vi.stubGlobal('document', { documentElement: { clientHeight: 800 } })
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => frames.push(callback))
    vi.stubGlobal('cancelAnimationFrame', () => { frames = [] })
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    const { nearViewport } = await import('./near-viewport')
    const node = (top: number) => ({ isConnected: true, parentElement: null, getBoundingClientRect: () => ({ top }) }) as unknown as HTMLElement
    // A frame runs the queued checks, as the browser would before the next paint.
    const nextFrame = () => { const due = frames; frames = []; due.forEach((callback) => callback()) }
    return { window, nearViewport, node, nextFrame }
  }

  it('registers nothing without options', async () => {
    const { window, nearViewport, node, nextFrame } = await setup()
    const action = nearViewport(node(100))
    nextFrame()
    expect(window.addEventListener).not.toHaveBeenCalled()
    action.destroy()
    expect(window.removeEventListener).not.toHaveBeenCalled()
  })

  it('calls onEnter once for a node near the viewport', async () => {
    const { nearViewport, node, nextFrame } = await setup()
    const onEnter = vi.fn()
    nearViewport(node(100), { onEnter })
    nextFrame()
    nextFrame()
    expect(onEnter).toHaveBeenCalledTimes(1)
  })

  it('keeps a far node waiting, and update(undefined) releases its listeners', async () => {
    const { window, nearViewport, node, nextFrame } = await setup()
    const onEnter = vi.fn()
    const action = nearViewport(node(5000), { onEnter })
    nextFrame()
    expect(onEnter).not.toHaveBeenCalled()
    expect(window.addEventListener).toHaveBeenCalledTimes(2)
    action.update(undefined)
    expect(window.removeEventListener).toHaveBeenCalledTimes(2)
    action.destroy()
    expect(onEnter).not.toHaveBeenCalled()
  })

  it('switches on later through update, once only', async () => {
    const { window, nearViewport, node, nextFrame } = await setup()
    const action = nearViewport(node(100))
    const onEnter = vi.fn()
    action.update({ onEnter })
    nextFrame()
    expect(onEnter).toHaveBeenCalledTimes(1)
    expect(window.removeEventListener).toHaveBeenCalledTimes(2)
    action.update({ onEnter })
    nextFrame()
    expect(onEnter).toHaveBeenCalledTimes(1)
    expect(window.addEventListener).toHaveBeenCalledTimes(2)
  })

  it('skips a node released by an earlier node in the same pass', async () => {
    const { nearViewport, node, nextFrame } = await setup()
    const onEnterB = vi.fn()
    let b: ReturnType<typeof nearViewport>
    nearViewport(node(100), { onEnter: () => b.destroy() })
    b = nearViewport(node(100), { onEnter: onEnterB })
    nextFrame()
    expect(onEnterB).not.toHaveBeenCalled()
  })
})

describe('offscreenDistance', () => {
  const rect = (left: number, top: number, right: number, bottom: number) => ({ getBoundingClientRect: () => ({ left, top, right, bottom }) as DOMRect })

  it('is 0 for anything that touches the viewport', () => {
    expect(offscreenDistance(rect(100, 100, 250, 400), 1000, 800)).toBe(0)
    expect(offscreenDistance(rect(-100, -50, 20, 10), 1000, 800)).toBe(0)
    expect(offscreenDistance(rect(900, 700, 1100, 900), 1000, 800)).toBe(0)
  })

  it('measures the gap above, below, left and right, and adds the two axes', () => {
    expect(offscreenDistance(rect(100, 1500, 250, 1800), 1000, 800)).toBe(700)
    expect(offscreenDistance(rect(100, -600, 250, -300), 1000, 800)).toBe(300)
    expect(offscreenDistance(rect(1200, 100, 1350, 400), 1000, 800)).toBe(200)
    expect(offscreenDistance(rect(-400, 100, -250, 400), 1000, 800)).toBe(250)
    expect(offscreenDistance(rect(1200, 1500, 1350, 1800), 1000, 800)).toBe(900)
  })

  it('treats a card that is not mounted as far away', () => {
    expect(offscreenDistance(undefined, 1000, 800)).toBe(Infinity)
  })
})
