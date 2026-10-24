// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ANCHOR_SLIDE_MS, ANCHOR_SNAP_MS, anchorEase, anchorScrollLeft, anchorScrollTop, animateScroll, stopScroll } from './anchor'
import { initDpadNav } from './index'
import { controllerMode } from './input'

// The reference curve, cubic-bezier(.2,.8,.2,1), from its own polynomial form and Newton's method
// to 1e-12: a different solver from the implementation's, so the two check each other.
const refX = (u: number) => u ** 3 - 0.6 * u ** 2 + 0.6 * u
const refY = (u: number) => 0.4 * u ** 3 - 1.8 * u ** 2 + 2.4 * u
function reference(t: number): number {
  let u = t
  for (let i = 0; i < 100; i++) {
    // x'(u) = 3u² − 1.2u + 0.6 has no real root, so Newton never divides by zero.
    const next = u - (refX(u) - t) / (3 * u ** 2 - 1.2 * u + 0.6)
    const done = Math.abs(next - u) < 1e-12
    u = next
    if (done) break
  }
  return refY(u)
}

// A frame queue standing in for requestAnimationFrame: `frame(now)` runs what is due at `now`.
const frames = new Map<number, FrameRequestCallback>()
let nextFrame = 0
const frame = (now: number) => {
  const due = [...frames.values()]
  frames.clear()
  for (const callback of due) callback(now)
}

beforeEach(() => {
  frames.clear()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('anchorEase', () => {
  it('starts at 0 and ends at 1, clamped outside', () => {
    expect(anchorEase(0)).toBe(0)
    expect(anchorEase(1)).toBe(1)
    expect(anchorEase(-0.5)).toBe(0)
    expect(anchorEase(1.5)).toBe(1)
  })

  it('never goes backwards', () => {
    let previous = 0
    for (let i = 1; i <= 100; i++) {
      const value = anchorEase(i / 100)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })

  it('follows cubic-bezier(.2,.8,.2,1)', () => {
    for (const t of [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99]) expect(anchorEase(t)).toBeCloseTo(reference(t), 6)
    // A strong ease-out: about 95% of the way there at half time.
    expect(anchorEase(0.5)).toBeCloseTo(0.9461, 4)
  })
})

describe('anchorScrollLeft', () => {
  it('puts the focused card where the first card rests', () => {
    expect(anchorScrollLeft({ cardLeft: 692, trackLeft: 0, paddingLeft: 32, scrollLeft: 0, maxScroll: 3000 })).toBe(660)
    // Moving back: the card sits left of the slot, partly scrolled off.
    expect(anchorScrollLeft({ cardLeft: -298, trackLeft: 0, paddingLeft: 32, scrollLeft: 660, maxScroll: 3000 })).toBe(330)
    // A track that starts right of a side rail.
    expect(anchorScrollLeft({ cardLeft: 418, trackLeft: 56, paddingLeft: 32, scrollLeft: 100, maxScroll: 3000 })).toBe(430)
  })

  it('stops at the ends of the track', () => {
    expect(anchorScrollLeft({ cardLeft: 20, trackLeft: 0, paddingLeft: 32, scrollLeft: 0, maxScroll: 3000 })).toBe(0)
    expect(anchorScrollLeft({ cardLeft: 900, trackLeft: 0, paddingLeft: 32, scrollLeft: 2900, maxScroll: 3000 })).toBe(3000)
    // A track that does not overflow cannot scroll at all.
    expect(anchorScrollLeft({ cardLeft: 692, trackLeft: 0, paddingLeft: 32, scrollLeft: 0, maxScroll: -40 })).toBe(0)
  })
})

describe('anchorScrollTop', () => {
  it('puts the row top `offset` below the viewport top', () => {
    expect(anchorScrollTop({ rowTop: 700, scrollY: 0, offset: 137, maxScroll: 5000 })).toBe(563)
    expect(anchorScrollTop({ rowTop: -200, scrollY: 1000, offset: 137, maxScroll: 5000 })).toBe(663)
  })

  it('stops at the top and the bottom of the page', () => {
    expect(anchorScrollTop({ rowTop: 50, scrollY: 0, offset: 137, maxScroll: 5000 })).toBe(0)
    expect(anchorScrollTop({ rowTop: 900, scrollY: 4800, offset: 137, maxScroll: 5000 })).toBe(5000)
    expect(anchorScrollTop({ rowTop: 700, scrollY: 0, offset: 137, maxScroll: -10 })).toBe(0)
  })
})

describe('animateScroll', () => {
  let value = 100
  const get = () => value
  const set = (next: number) => { value = next }
  beforeEach(() => { value = 100 })

  it('eases from the current value to the target over `ms`', () => {
    animateScroll({}, get, set, 700, 650)
    frame(1000)
    expect(value).toBe(100)
    frame(1325)
    expect(value).toBeCloseTo(100 + 600 * reference(0.5), 6)
    frame(1650)
    expect(value).toBe(700)
    expect(frames.size).toBe(0)
  })

  it('jumps at once for ms <= 0', () => {
    animateScroll({}, get, set, 700, 0)
    expect(value).toBe(700)
    expect(frames.size).toBe(0)
  })

  it('stops when cancelled', () => {
    const cancel = animateScroll({}, get, set, 700, 650)
    frame(0)
    frame(100)
    const reached = value
    cancel()
    expect(frames.size).toBe(0)
    frame(650)
    expect(value).toBe(reached)
  })

  it('a new animation on the same key replaces the running one; other keys carry on', () => {
    const key = {}
    let other = 0
    animateScroll({}, () => other, (next) => { other = next }, 50, 650)
    animateScroll(key, get, set, 700, 650)
    frame(0)
    frame(200)
    animateScroll(key, get, set, 0, 650)
    expect(frames.size).toBe(2)
    frame(300)
    frame(950)
    expect(value).toBe(0)
    expect(other).toBe(50)
  })

  it('stopScroll stops the animation on that key', () => {
    const key = {}
    animateScroll(key, get, set, 700, 650)
    stopScroll(key)
    expect(frames.size).toBe(0)
    stopScroll({})
  })
})

// The anchored branch of revealFocused, driven through real key presses as the controller sends
// them. jsdom has no layout: rects come from `data-rect` (left,top,width,height); a fixed probe
// whose top is `--theme-shell-top` measures 72 px, as under a TV top bar.
describe('anchored rows', () => {
  function rectOf(this: Element): DOMRect {
    const probe = this instanceof HTMLElement && this.style.top.includes('--theme-shell-top')
    const [left, top, width, height] = (this.getAttribute('data-rect') ?? (probe ? '0,72,0,0' : '0,0,0,0')).split(',').map(Number)
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect
  }
  const press = (key: string, repeat = false) =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key, repeat, bubbles: true, cancelable: true }))
  const button = (label: string) => [...document.querySelectorAll<HTMLElement>('[data-focusable]')].find((node) => node.textContent === label)!
  const cards = (row: string, top: number) => Array.from({ length: 6 }, (_, i) =>
    `<button data-focusable data-rect="${32 + i * 330},${top},312,280">${row}${i}</button>`).join('')
  const row = (id: string, top: number, style = '') => `
    <section data-slot="row" data-row-focus="anchor" data-nav-row id="${id}" style="${style}" data-rect="0,${top},1280,400">
      <div data-carousel-scroller data-nav-row-items style="padding-left: 32px" data-rect="0,${top + 50},1280,300">${cards(id, top + 50)}</div>
    </section>`

  let pageY = 0
  let windowScrolls: ScrollToOptions[] = []
  const trackScrolls = new Map<Element, ScrollToOptions[]>()

  beforeAll(() => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
    initDpadNav()
  })

  beforeEach(() => {
    Element.prototype.getBoundingClientRect = rectOf
    pageY = 0
    windowScrolls = []
    trackScrolls.clear()
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => pageY })
    window.scrollTo = ((options: ScrollToOptions) => {
      windowScrolls.push(options)
      if (options.top !== undefined) pageY = options.top
    }) as typeof window.scrollTo
    window.scrollBy = (() => {}) as typeof window.scrollBy
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 5000 })
    document.body.innerHTML = `
      <main>
        <button data-focusable data-nav-scroll-top data-rect="100,20,200,50">Play</button>
        ${row('a', 400, 'scroll-margin-top: 137px')}
        ${row('b', 900)}
      </main>`
    // Each track overflows by 1000 px and remembers where it was scrolled to.
    for (const track of document.querySelectorAll<HTMLElement>('[data-carousel-scroller]')) {
      let left = 0
      trackScrolls.set(track, [])
      Object.defineProperty(track, 'scrollLeft', { configurable: true, get: () => left })
      Object.defineProperty(track, 'scrollWidth', { configurable: true, value: 2280 })
      Object.defineProperty(track, 'clientWidth', { configurable: true, value: 1280 })
      track.scrollTo = ((options: ScrollToOptions) => {
        trackScrolls.get(track)!.push(options)
        if (options.left !== undefined) left = options.left
      }) as typeof track.scrollTo
    }
  })

  afterEach(() => {
    document.body.replaceChildren()
    delete document.documentElement.dataset.motion
  })

  const track = (id: string) => document.querySelector<HTMLElement>(`#${id} [data-carousel-scroller]`)!

  it('slides the track so the focused card takes the first column', () => {
    button('a1').focus()
    press('ArrowRight')
    expect(document.activeElement).toBe(button('a2'))
    frame(0)
    frame(ANCHOR_SLIDE_MS / 2)
    expect(track('a').scrollLeft).toBeCloseTo(660 * reference(0.5), 6)
    frame(ANCHOR_SLIDE_MS)
    // a2 rests at 692; the first card rests at the track's 32 px padding.
    expect(track('a').scrollLeft).toBe(660)
    expect(trackScrolls.get(track('a'))!.every((options) => options.behavior === 'instant')).toBe(true)
    expect(windowScrolls).toEqual([])
  })

  // Row a's cards, 18 px apart from `by` px of scroll, card `wide` grown to a theme's 905 px tile.
  const layOut = (wide: number, by: number) => {
    let left = 32 - by
    for (const [i, card] of [...track('a').children].entries()) {
      const width = i === wide ? 905 : 312
      card.setAttribute('data-rect', `${left},450,${width},280`)
      left += width + 18
    }
  }
  // The CSS transitions row a reports running, as [card, property]; jsdom has no Web Animations.
  const running = (...transitions: [string, string][]) => {
    track('a').getAnimations = () => transitions.map(([label, transitionProperty]) =>
      ({ transitionProperty, effect: { target: button(label) } })) as unknown as Animation[]
  }
  const widthEnd = () => button('a1').dispatchEvent(new TransitionEvent('transitionend', { propertyName: 'width', bubbles: true }))

  it('aims for where the cards before the focused one settle once their width transitions end', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    layOut(0, 0)
    // a0 shrinks back to a resting card's 312 px as a1 grows.
    running(['a0', 'width'], ['a1', 'width'])
    button('a0').focus()
    press('ArrowRight')
    frame(0)
    frame(300)
    // Measured with a0 still 905 px wide (923), yet heading for a1's settled place from the start.
    expect(track('a').scrollLeft).toBeCloseTo(330 * reference(300 / ANCHOR_SLIDE_MS), 6)
    running()
    layOut(1, track('a').scrollLeft)
    widthEnd()
    frame(ANCHOR_SLIDE_MS)
    expect(track('a').scrollLeft).toBe(330)
    expect(Math.max(...trackScrolls.get(track('a'))!.map((options) => options.left!))).toBe(330)
    // On to a2: a0 rests, so only a1's shrink counts (1253 measured, 660 settled).
    layOut(1, 330)
    running(['a1', 'width'], ['a2', 'width'])
    press('ArrowRight')
    frame(1000)
    frame(1000 + ANCHOR_SLIDE_MS)
    expect(track('a').scrollLeft).toBe(660)
    // Back left: a2 shrinks after a1, and a1's own growth never moves its left edge.
    layOut(2, 660)
    running(['a1', 'width'], ['a2', 'width'])
    press('ArrowLeft')
    frame(2000)
    frame(2000 + ANCHOR_SLIDE_MS)
    expect(track('a').scrollLeft).toBe(330)
  })

  it("re-anchors when a theme's card-width transition ends, then stops listening", () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    layOut(0, 0)
    // a0's only running transition is not of its width, so no correction.
    running(['a0', 'opacity'])
    button('a0').focus()
    press('ArrowRight')
    expect(document.activeElement).toBe(button('a1'))
    frame(0)
    frame(300)
    // Measured while a0 was still wide, so heading for 923, past a1's settled place.
    expect(track('a').scrollLeft).toBeGreaterThan(330)
    // The transition ends: a0 is back to 312 and a1 is 905.
    running()
    layOut(1, track('a').scrollLeft)
    widthEnd()
    frame(400)
    frame(400 + ANCHOR_SLIDE_MS)
    // a1's left edge (362 - 330) sits on the track's 32 px padding.
    expect(track('a').scrollLeft).toBe(330)
    // A second after the move the track no longer listens.
    vi.advanceTimersByTime(1000)
    layOut(1, 0)
    widthEnd()
    expect(frames.size).toBe(0)
    expect(track('a').scrollLeft).toBe(330)
  })

  it('a held repeat and reduced motion jump', () => {
    button('a1').focus()
    press('ArrowRight', true)
    expect(track('a').scrollLeft).toBe(660)
    expect(frames.size).toBe(0)

    document.documentElement.dataset.motion = 'reduced'
    press('ArrowDown')
    expect(document.activeElement).toBe(button('b2'))
    expect(pageY).toBe(900 - 72 - 16)
    expect(frames.size).toBe(0)
  })

  it('snaps an entered row to its scroll-margin-top', () => {
    button('Play').focus()
    press('ArrowDown')
    expect(document.activeElement).toBe(button('a0'))
    frame(0)
    frame(ANCHOR_SNAP_MS)
    expect(pageY).toBe(400 - 137)
    expect(trackScrolls.get(track('a'))).toEqual([])
  })

  it('without a scroll margin, snaps the row 16 px under the top bar and removes the probe', () => {
    button('a1').focus()
    press('ArrowDown')
    expect(document.activeElement).toBe(button('b1'))
    frame(0)
    frame(ANCHOR_SNAP_MS)
    expect(pageY).toBe(900 - 72 - 16)
    expect(document.body.children).toHaveLength(1)
  })

  it('hands the page back and forth with the ordinary reveal without either fighting the other', () => {
    button('Play').focus()
    press('ArrowDown')
    frame(0)
    frame(100)
    expect(frames.size).toBe(1)
    // Up into the hero keeps its smooth scroll to the top, and stops the snap still running.
    press('ArrowUp')
    expect(document.activeElement).toBe(button('Play'))
    expect(frames.size).toBe(0)
    expect(windowScrolls.at(-1)).toEqual({ top: 0, behavior: 'smooth' })
    // Straight back down: that smooth scroll is stopped where it is before the snap starts.
    windowScrolls = []
    press('ArrowDown')
    expect(windowScrolls[0]).toMatchObject({ left: window.scrollX, top: 0, behavior: 'instant' })
    frame(1000)
    frame(1000 + ANCHOR_SNAP_MS)
    expect(pageY).toBe(400 - 137)
  })

  // The row fast path (pickInNavRows) runs for a controller, Game mode and TV.
  describe('moving down into an anchored row', () => {
    beforeEach(() => { controllerMode.set(true) })
    afterEach(() => { controllerMode.set(false) })

    // a0 focused and widened as a theme's focused tile grows; b scrolled `by` px, so its cards sit
    // that far left of where they rest.
    function setUp(by: number) {
      button('a0').setAttribute('data-rect', '32,450,905,280')
      track('b').scrollTo({ left: by })
      for (const [i, card] of [...track('b').children].entries()) card.setAttribute('data-rect', `${32 + i * 330 - by},950,312,280`)
      button('a0').focus()
    }

    it('lands on the card in the first column, not the one under the wide tile', () => {
      setUp(990)
      press('ArrowDown')
      expect(document.activeElement).toBe(button('b3'))
      // The row keeps its own scroll; only the page snaps.
      expect(track('b').scrollLeft).toBe(990)
    })

    it('between two cards, takes the one after the first column', () => {
      setUp(990 + 165)
      press('ArrowDown')
      expect(document.activeElement).toBe(button('b4'))
    })

    it('a row that is not anchored keeps the pick under the focused tile', () => {
      document.getElementById('b')!.removeAttribute('data-row-focus')
      setUp(990)
      press('ArrowDown')
      expect(document.activeElement).toBe(button('b4'))
    })
  })
})
