// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { focusWhenIdle } from './initial-focus'

let frames: FrameRequestCallback[] = []
beforeEach(() => {
  frames = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })
const flush = () => { for (let i = 0; i < 4 && frames.length; i++) frames.splice(0).forEach((callback) => callback(0)) }

describe('focusWhenIdle', () => {
  it('focuses the node’s focusable when nothing holds focus', () => {
    document.body.innerHTML = '<div id="wrap"><div id="card" data-focusable tabindex="0"></div></div>'
    focusWhenIdle(document.getElementById('wrap')!, () => true)
    flush()
    expect(document.activeElement?.id).toBe('card')
  })
  it('leaves an existing focus (a restore) alone', () => {
    document.body.innerHTML = '<button id="restored">r</button><div id="wrap"><div data-focusable tabindex="0"></div></div>'
    document.getElementById('restored')!.focus()
    focusWhenIdle(document.getElementById('wrap')!, () => true)
    flush()
    expect(document.activeElement?.id).toBe('restored')
  })
  it('brings a focused card that sits off screen into view', () => {
    document.body.innerHTML = '<div id="wrap"><div id="card" data-focusable tabindex="0"></div></div>'
    const card = document.getElementById('card')!
    card.getBoundingClientRect = () => ({ top: -120, bottom: 40, left: 0, right: 100, width: 100, height: 160, x: 0, y: -120, toJSON: () => ({}) })
    const reveal = vi.fn()
    card.scrollIntoView = reveal
    focusWhenIdle(document.getElementById('wrap')!, () => true)
    flush()
    expect(reveal).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' })
  })
  it('does nothing when disabled', () => {
    document.body.innerHTML = '<div id="wrap"><div data-focusable tabindex="0"></div></div>'
    focusWhenIdle(document.getElementById('wrap')!, false)
    flush()
    expect(document.activeElement).toBe(document.body)
  })
})
