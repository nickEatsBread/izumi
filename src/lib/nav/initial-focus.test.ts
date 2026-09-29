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
  it('does nothing when disabled', () => {
    document.body.innerHTML = '<div id="wrap"><div data-focusable tabindex="0"></div></div>'
    focusWhenIdle(document.getElementById('wrap')!, false)
    flush()
    expect(document.activeElement).toBe(document.body)
  })
})
