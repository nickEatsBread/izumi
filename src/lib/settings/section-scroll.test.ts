// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gameMode } from '$lib/player/session'
import { motionPreference } from '$lib/settings/ui'
import { sectionFade, trackSectionScroll, type SectionScrollState } from './section-scroll'
import { SUBCATEGORY_OPEN_EVENT } from './sections'

// jsdom has no layout: each element reports the top/bottom held here, keyed by id ('header' for
// the page header).
let rects: Record<string, { top: number; bottom: number }>
let frames: Map<number, FrameRequestCallback>
let nextFrame = 0
let scrollIntoView: ReturnType<typeof vi.fn>
// Every tracker a test starts, destroyed after it so its window listeners do not leak into the next.
let trackers: { destroy(): void }[] = []
// Runs every pending frame, including frames those callbacks request.
const flushFrames = () => {
  for (const [id, callback] of frames) {
    frames.delete(id)
    callback(0)
  }
}

function rectOf(this: Element): DOMRect {
  const key = this.id || (this.hasAttribute('data-settings-section-header') ? 'header' : '')
  const { top, bottom } = rects[key] ?? { top: 0, bottom: 0 }
  return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) } as DOMRect
}

function setScroll(y: number, innerHeight = 700, scrollHeight = 2000) {
  Object.defineProperty(window, 'scrollY', { configurable: true, value: y })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: innerHeight })
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: scrollHeight })
}

/** `bar` and `margin` stand in for the sticky bar's top padding and the subcategories' scroll
 *  margin, which jsdom cannot resolve from the Tailwind classes. The default margin is the 2rem
 *  titlebar band's 96 px. */
function track(subcategories = ['up-next', 'skipping', 'advanced'], { bar, margin = '96px' }: { bar?: string; margin?: string } = {}) {
  document.body.innerHTML = `<div data-settings-section="playback">
    ${bar ? `<div data-settings-sticky style="padding-top: ${bar}"></div>` : ''}
    <header data-settings-section-header></header>
    ${subcategories.map((id) => `<section id="${id}" data-settings-subcategory="${id}"${id === 'advanced' ? ' data-collapsed' : ''} style="scroll-margin-top: ${margin}"></section>`).join('')}
  </div>`
  const root = document.querySelector<HTMLElement>('[data-settings-section]')!
  const header = document.querySelector<HTMLElement>('[data-settings-section-header]')!
  const states: SectionScrollState[] = []
  const tracker = trackSectionScroll(root, header, (state) => states.push(state))
  trackers.push(tracker)
  return { tracker, states, last: () => states[states.length - 1] }
}

const scroll = () => {
  window.dispatchEvent(new Event('scroll'))
  flushFrames()
}
const osPrefersReducedMotion = () =>
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' }))

beforeEach(() => {
  rects = {
    header: { top: 32, bottom: 76 },
    'up-next': { top: 140, bottom: 500 },
    skipping: { top: 520, bottom: 900 },
    advanced: { top: 920, bottom: 980 },
  }
  frames = new Map()
  setScroll(0)
  Element.prototype.getBoundingClientRect = rectOf
  scrollIntoView = vi.fn()
  Element.prototype.scrollIntoView = scrollIntoView as unknown as Element['scrollIntoView']
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.set(++nextFrame, callback) && nextFrame)
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
})

afterEach(() => {
  for (const tracker of trackers) tracker.destroy()
  trackers = []
  vi.unstubAllGlobals()
  motionPreference.set('system')
  gameMode.set(false)
  document.documentElement.style.zoom = ''
  document.body.replaceChildren()
})

describe('trackSectionScroll', () => {
  it('lists only the subcategories rendered on the page, in page order', () => {
    expect(track(['up-next', 'advanced']).last().ids).toEqual(['up-next', 'advanced'])
  })

  it('starts on the first subcategory with the header in view', () => {
    expect(track().last()).toEqual({ ids: ['up-next', 'skipping', 'advanced'], active: 'up-next', stuck: false })
  })

  it('lights the subcategory whose heading has passed the reading line', () => {
    const { last } = track()
    rects = { header: { top: -400, bottom: -356 }, 'up-next': { top: -300, bottom: 60 }, skipping: { top: 100, bottom: 480 }, advanced: { top: 700, bottom: 760 } }
    setScroll(500)
    scroll()
    expect(last()).toEqual({ ids: ['up-next', 'skipping', 'advanced'], active: 'skipping', stuck: true })
  })

  it('shows the sticky bar only while the header is out of view', () => {
    const { last } = track()
    rects.header = { top: -43, bottom: 1 }
    scroll()
    expect(last().stuck).toBe(false)
    rects.header = { top: -44, bottom: 0 }
    scroll()
    expect(last().stuck).toBe(true)
    rects.header = { top: -24, bottom: 20 }
    scroll()
    expect(last().stuck).toBe(false)
  })

  it('shows the sticky bar once the header has gone under the titlebar band the bar pads over', () => {
    // A top nav bar: --theme-shell-top 4.75rem (76 px) plus the bar's 0.625rem, under a 1.5 UI zoom.
    document.documentElement.style.zoom = '1.5'
    const { last } = track(undefined, { bar: '86px' })
    rects.header = { top: 85, bottom: 130 }
    scroll()
    expect(last().stuck).toBe(false)
    rects.header = { top: 84, bottom: 129 }
    scroll()
    expect(last().stuck).toBe(true)
  })

  it('reports a state only when it changes, measuring at most once per frame', () => {
    const { states } = track()
    expect(states).toHaveLength(1)
    window.dispatchEvent(new Event('scroll'))
    window.dispatchEvent(new Event('scroll'))
    expect(frames.size).toBe(1)
    flushFrames()
    expect(states).toHaveLength(1)
  })

  it('places the reading line in screen px under the UI-scale zoom', () => {
    document.documentElement.style.zoom = '2'
    const { last } = track()
    rects.skipping = { top: 200, bottom: 580 }
    scroll()
    expect(last().active).toBe('skipping')
    rects.skipping = { top: 230, bottom: 610 }
    scroll()
    expect(last().active).toBe('up-next')
  })

  it('moves the reading line with the subcategory scroll margin, so a jump under a top bar lights its own chip', () => {
    // A top nav bar: the scroll margin is --theme-shell-top 4.75rem + 4rem = 140 px; the line sits 16 px lower.
    const { last } = track(undefined, { margin: '140px' })
    rects.skipping = { top: 156, bottom: 536 }
    scroll()
    expect(last().active).toBe('skipping')
    rects.skipping = { top: 157, bottom: 537 }
    scroll()
    expect(last().active).toBe('up-next')
  })

  it('lights the last subcategory once the page is scrolled to its end', () => {
    const { last } = track()
    rects = { header: { top: -1000, bottom: -956 }, 'up-next': { top: -900, bottom: -500 }, skipping: { top: -100, bottom: 280 }, advanced: { top: 300, bottom: 360 } }
    setScroll(1300, 700, 2000)
    scroll()
    expect(last().active).toBe('advanced')
  })

  it('does not treat a short page that cannot scroll as scrolled to its end', () => {
    setScroll(0, 700, 600)
    expect(track().last().active).toBe('up-next')
  })

  it('names the open event as the contract does', () => {
    expect(SUBCATEGORY_OPEN_EVENT).toBe('izumi-subcategory-open')
  })

  it('jump unfolds a folded subcategory, then scrolls to it smoothly once it has unfolded, and keeps its chip lit', () => {
    const { tracker, last } = track()
    const advanced = document.getElementById('advanced')!
    const opened = vi.fn()
    advanced.addEventListener(SUBCATEGORY_OPEN_EVENT, opened)
    tracker.jump('advanced')
    expect(opened).toHaveBeenCalledOnce()
    // Svelte unhides the body on its next flush, so the scroll waits a frame for the page to grow.
    expect(scrollIntoView).not.toHaveBeenCalled()
    flushFrames()
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    expect(scrollIntoView.mock.contexts[0]).toBe(advanced)
    expect(last().active).toBe('advanced')
    // The smooth scroll's own scroll events keep it lit.
    scroll()
    expect(last().active).toBe('advanced')
  })

  it.each(['wheel', 'touchstart', 'keydown', 'pointerdown'])('a %s of the user ends the jump hold', (type) => {
    const { tracker, last } = track()
    tracker.jump('skipping')
    flushFrames()
    expect(last().active).toBe('skipping')
    window.dispatchEvent(new Event(type))
    flushFrames()
    expect(last().active).toBe('up-next')
  })

  it('jump leaves an open subcategory as it is', () => {
    const { tracker } = track()
    const opened = vi.fn()
    document.getElementById('skipping')!.addEventListener(SUBCATEGORY_OPEN_EVENT, opened)
    tracker.jump('skipping')
    expect(opened).not.toHaveBeenCalled()
    expect(scrollIntoView).toHaveBeenCalledOnce()
  })

  it("jumps instantly under izumi's Reduce motion setting", () => {
    motionPreference.set('reduce')
    track().tracker.jump('skipping')
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'instant', block: 'start' })
  })

  it('jumps instantly when the system asks for reduced motion', () => {
    osPrefersReducedMotion()
    track().tracker.jump('skipping')
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'instant', block: 'start' })
  })

  it('ignores a jump to a subcategory the page does not render', () => {
    track().tracker.jump('controls')
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('stops following the page once destroyed', () => {
    const { tracker } = track()
    tracker.jump('skipping')
    tracker.destroy()
    window.dispatchEvent(new Event('scroll'))
    window.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('wheel'))
    expect(frames.size).toBe(0)
  })

  it('drops a pending jump scroll once destroyed', () => {
    const { tracker } = track()
    tracker.jump('advanced')
    tracker.destroy()
    flushFrames()
    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})

describe('sectionFade', () => {
  it('fades the new section in with a 6 px rise over 160 ms', () => {
    expect(sectionFade()).toEqual({ y: 6, opacity: 0, duration: 160 })
  })

  it("is instant under izumi's Reduce motion setting", () => {
    motionPreference.set('reduce')
    expect(sectionFade().duration).toBe(0)
  })

  it('is instant when the system asks for reduced motion', () => {
    osPrefersReducedMotion()
    expect(sectionFade().duration).toBe(0)
  })

  it('is instant in Game mode, where the end of a CSS animation blinks', () => {
    gameMode.set(true)
    expect(sectionFade().duration).toBe(0)
  })
})
