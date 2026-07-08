import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { get } from 'svelte/store'
import { scrub, initScrub, beginScrub, moveScrub, endScrub } from './scrub'

describe('scrub store', () => {
  beforeEach(() => { initScrub(() => {}); endScrub(); })
  afterEach(() => vi.unstubAllGlobals())

  it('begin activates with the start time + source', () => {
    beginScrub(30, 'pad')
    expect(get(scrub)).toEqual({ active: true, time: 30, source: 'pad' })
  })

  it('move updates time only while active', () => {
    beginScrub(30, 'touch')
    moveScrub(45)
    expect(get(scrub).time).toBe(45)
    endScrub()
    moveScrub(99)
    expect(get(scrub).time).toBe(45)
  })

  it('coalesces rapid moves to the latest animation-frame value', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    beginScrub(30, 'touch')
    moveScrub(45)
    moveScrub(60)
    expect(get(scrub).time).toBe(30)
    frames[0](16)
    expect(get(scrub).time).toBe(60)
  })

  it('end commits the current time via the wired seek and deactivates', () => {
    const seek = vi.fn()
    initScrub(seek)
    beginScrub(30, 'pad')
    moveScrub(50)
    endScrub()
    expect(seek).toHaveBeenCalledWith(50)
    expect(get(scrub).active).toBe(false)
  })

  it('end flushes a pending animation-frame move before committing', () => {
    const seek = vi.fn()
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    initScrub(seek)
    beginScrub(30, 'pad')
    moveScrub(75)
    endScrub()
    expect(seek).toHaveBeenCalledWith(75)
    expect(get(scrub)).toEqual({ active: false, time: 75, source: null })
  })

  it('end does not commit when it was not active', () => {
    const seek = vi.fn()
    initScrub(seek)
    endScrub()
    expect(seek).not.toHaveBeenCalled()
  })
})
