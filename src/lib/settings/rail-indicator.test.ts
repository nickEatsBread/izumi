// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { motionPreference } from '$lib/settings/ui'
import { railIndicator as attachRailIndicator } from './rail-indicator'

// jsdom has no layout: each rail link reports the offsetTop/offsetHeight held here.
let layout: Record<string, [top: number, height: number]>
let frames: FrameRequestCallback[]
// Every action is destroyed after its test, so no window resize listener leaks into the next.
let actions: ReturnType<typeof attachRailIndicator>[]
const railIndicator = (nav: HTMLElement, current: string | null) => {
  const action = attachRailIndicator(nav, current)
  actions.push(action)
  return action
}
const flushFrames = () => {
  while (frames.length) frames.shift()?.(0)
}
const osPrefersReducedMotion = () =>
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' }))

function mountRail() {
  document.body.innerHTML = `
    <nav data-settings-rail>
      <div data-part="settings.rail.indicator" aria-hidden="true" hidden></div>
      <div role="group">
        <div>Watch</div>
        <a href="/app/settings/playback" data-section="playback">Playback</a>
        <a href="/app/settings/subtitles" data-section="subtitles">Subtitles</a>
      </div>
      <div role="group">
        <div>System</div>
        <a href="/app/settings/about" data-section="about">About</a>
      </div>
    </nav>`
  for (const link of document.querySelectorAll<HTMLElement>('a[data-section]')) {
    const section = link.dataset.section!
    Object.defineProperty(link, 'offsetTop', { configurable: true, get: () => layout[section][0] })
    Object.defineProperty(link, 'offsetHeight', { configurable: true, get: () => layout[section][1] })
  }
  const nav = document.querySelector<HTMLElement>('nav')!
  return { nav, indicator: nav.querySelector<HTMLElement>('[data-part="settings.rail.indicator"]')! }
}

beforeEach(() => {
  layout = { playback: [28, 36], subtitles: [68, 36], about: [140, 40] }
  frames = []
  actions = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => {
  for (const action of actions) action.destroy()
  vi.unstubAllGlobals()
  motionPreference.set('system')
  document.body.replaceChildren()
})

describe('railIndicator', () => {
  it('sits on the current section at first paint without sliding there', () => {
    const { nav, indicator } = mountRail()
    railIndicator(nav, 'subtitles')
    expect(indicator.hidden).toBe(false)
    expect(indicator.style.transform).toBe('translateY(68px)')
    expect(indicator.style.height).toBe('36px')
    expect(indicator.hasAttribute('data-animate')).toBe(false)
  })

  it('slides to the next section', () => {
    const { nav, indicator } = mountRail()
    const action = railIndicator(nav, 'playback')
    action.update('about')
    expect(indicator.style.transform).toBe('translateY(140px)')
    expect(indicator.style.height).toBe('40px')
    expect(indicator.hasAttribute('data-animate')).toBe(true)
  })

  it("jumps instead under izumi's Reduce motion setting", () => {
    motionPreference.set('reduce')
    const { nav, indicator } = mountRail()
    railIndicator(nav, 'playback').update('about')
    expect(indicator.style.transform).toBe('translateY(140px)')
    expect(indicator.hasAttribute('data-animate')).toBe(false)
  })

  it('jumps instead when the system asks for reduced motion', () => {
    osPrefersReducedMotion()
    const { nav, indicator } = mountRail()
    railIndicator(nav, 'playback').update('about')
    expect(indicator.hasAttribute('data-animate')).toBe(false)
  })

  it("slides despite the system preference when izumi's motion setting is Full", () => {
    osPrefersReducedMotion()
    motionPreference.set('full')
    const { nav, indicator } = mountRail()
    railIndicator(nav, 'playback').update('about')
    expect(indicator.hasAttribute('data-animate')).toBe(true)
  })

  it('hides when no section is current, and jumps back when one is', () => {
    const { nav, indicator } = mountRail()
    const action = railIndicator(nav, 'playback')
    action.update(null)
    expect(indicator.hidden).toBe(true)
    action.update('about')
    expect(indicator.hidden).toBe(false)
    expect(indicator.style.transform).toBe('translateY(140px)')
    expect(indicator.hasAttribute('data-animate')).toBe(false)
  })

  it('re-measures once per frame on resize, and stops after destroy', () => {
    const { nav, indicator } = mountRail()
    const action = railIndicator(nav, 'about')
    layout.about = [180, 40]
    window.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('resize'))
    expect(frames).toHaveLength(1)
    flushFrames()
    expect(indicator.style.transform).toBe('translateY(180px)')
    action.destroy()
    window.dispatchEvent(new Event('resize'))
    expect(frames).toHaveLength(0)
  })
})
