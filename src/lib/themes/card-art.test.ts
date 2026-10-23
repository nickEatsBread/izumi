import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Media } from '$lib/anilist/types'
import { queueTitleArt, type TitleExtras } from './title-extras'
import { nearViewport } from './card-art'

// A macrotask: every pending promise continuation has run by the time it fires.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('queueTitleArt', () => {
  it('runs at most four lookups at once and hands each freed slot to the next caller', async () => {
    let running = 0
    let peak = 0
    const releases: (() => void)[] = []
    const load = (media: Media) => new Promise<TitleExtras>((resolve) => {
      running++; peak = Math.max(peak, running)
      releases.push(() => { running--; resolve({ keyart: `k${media.id}` }) })
    })
    const results = Array.from({ length: 7 }, (_, i) => queueTitleArt({ id: i } as Media, new Set(['keyart']), load))
    await flush()
    expect(running).toBe(4)
    // Free one slot, and start a fresh call in the same tick: the freed slot goes to a waiter, never over 4.
    releases.shift()!()
    const late = queueTitleArt({ id: 99 } as Media, new Set(['keyart']), load)
    await flush()
    expect(running).toBe(4)
    expect(peak).toBe(4)
    while (releases.length) { releases.shift()!(); await flush() }
    expect((await Promise.all([...results, late])).map((r) => r.keyart)).toEqual(['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k99'])
  })

  it('frees its slot when a lookup fails', async () => {
    const failing = () => Promise.reject(new Error('offline'))
    await expect(queueTitleArt({ id: 1 } as Media, new Set(['logo']), failing)).rejects.toThrow('offline')
    const ok = await queueTitleArt({ id: 2 } as Media, new Set(['logo']), async () => ({ logo: 'l' }))
    expect(ok.logo).toBe('l')
  })
})

describe('nearViewport', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('fires once when the node nears the screen, and not at all without a callback', () => {
    const observers: { cb: IntersectionObserverCallback; options?: IntersectionObserverInit; disconnected: boolean }[] = []
    vi.stubGlobal('IntersectionObserver', class {
      record: (typeof observers)[number]
      constructor(cb: IntersectionObserverCallback, options?: IntersectionObserverInit) { this.record = { cb, options, disconnected: false }; observers.push(this.record) }
      observe() {}
      disconnect() { this.record.disconnected = true }
    })
    const node = {} as Element
    expect(nearViewport(node).update).toBeTypeOf('function')
    expect(observers).toHaveLength(0)
    const onnear = vi.fn()
    nearViewport(node, onnear)
    expect(observers[0].options?.rootMargin).toBe('100%')
    observers[0].cb([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver)
    expect(onnear).not.toHaveBeenCalled()
    observers[0].cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    expect(onnear).toHaveBeenCalledTimes(1)
    expect(observers[0].disconnected).toBe(true)
  })

  it('fires at once where IntersectionObserver is missing', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const onnear = vi.fn()
    nearViewport({} as Element, onnear)
    expect(onnear).toHaveBeenCalledTimes(1)
  })
})
