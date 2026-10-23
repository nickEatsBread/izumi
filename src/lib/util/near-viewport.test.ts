import { afterEach, describe, expect, it, vi } from 'vitest'
import { isNearViewport } from './near-viewport'

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
})
