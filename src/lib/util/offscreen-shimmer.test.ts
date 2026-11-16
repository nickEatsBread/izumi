// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pauseOffscreenShimmer } from './offscreen-shimmer'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, '../../app.css'), 'utf8')
const rootLayout = readFileSync(resolve(here, '../../routes/+layout.svelte'), 'utf8')

type Callback = (entries: { target: Element; isIntersecting: boolean }[]) => void
let callback: Callback
const observe = vi.fn()
const unobserve = vi.fn()
const disconnect = vi.fn()

function animationStart(target: Element, animationName: string) {
  const event = new Event('animationstart', { bubbles: true })
  Object.defineProperty(event, 'animationName', { value: animationName })
  target.dispatchEvent(event)
}

function skeleton() {
  const el = document.createElement('div')
  el.className = 'skeloader'
  document.body.append(el)
  return el
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb: Callback) { callback = cb }
    observe = observe
    unobserve = unobserve
    disconnect = disconnect
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  document.body.replaceChildren()
})

describe('off-screen shimmer', () => {
  it('observes each shimmer once, as its sweep starts', () => {
    const stop = pauseOffscreenShimmer()
    const el = skeleton()
    animationStart(el, 'skeleton-swipe')
    animationStart(el, 'skeleton-swipe')
    animationStart(skeleton(), 'hero-progress-fill')
    expect(observe).toHaveBeenCalledTimes(1)
    expect(observe).toHaveBeenCalledWith(el)
    stop()
  })

  it('marks a shimmer off screen while it is out of view, and clears it in view', () => {
    const stop = pauseOffscreenShimmer()
    const el = skeleton()
    animationStart(el, 'skeleton-swipe')
    callback([{ target: el, isIntersecting: false }])
    expect(el.hasAttribute('data-offscreen')).toBe(true)
    callback([{ target: el, isIntersecting: true }])
    expect(el.hasAttribute('data-offscreen')).toBe(false)
    stop()
  })

  it('stops observing a removed shimmer and observes it again if it comes back', () => {
    const stop = pauseOffscreenShimmer()
    const el = skeleton()
    animationStart(el, 'skeleton-swipe')
    el.remove()
    callback([{ target: el, isIntersecting: false }])
    expect(unobserve).toHaveBeenCalledWith(el)
    document.body.append(el)
    animationStart(el, 'skeleton-swipe')
    expect(observe).toHaveBeenCalledTimes(2)
    stop()
  })

  it('stops listening and disconnects on cleanup', () => {
    pauseOffscreenShimmer()()
    animationStart(skeleton(), 'skeleton-swipe')
    expect(observe).not.toHaveBeenCalled()
    expect(disconnect).toHaveBeenCalled()
  })

  it('pauses the marked sweep in app.css and starts from the root layout', () => {
    expect(css).toContain('.skeloader[data-offscreen]::before { animation-play-state: paused; }')
    // The sweep itself is unchanged wherever it can be seen.
    expect(css).toContain('animation: skeleton-swipe 1.5s infinite')
    expect(rootLayout).toContain('onMount(() => pauseOffscreenShimmer())')
  })
})
