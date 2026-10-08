// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gameMode } from '$lib/player/session'
import { GM_PANEL_IN_MS, GM_PANEL_OUT_MS, GM_THAW_DELAY_MS, gmPanel, gmPanelOut, gmStage } from './gm-freeze'

let now = 0
let frames: FrameRequestCallback[] = []
const flushFrame = (advance = 16) => {
  now += advance
  for (const run of frames.splice(0)) run(now)
}

beforeEach(() => {
  now = 0
  frames = []
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => frames.push(run))
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => {
  gameMode.set(false)
  gmStage.set('live')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('gmPanel', () => {
  it('does nothing outside Game mode', () => {
    const node = document.createElement('div')
    gmPanel(node)
    expect(node.style.opacity).toBe('')
    expect(node.style.transform).toBe('')
  })

  it('holds a panel hidden behind the video until the frozen frame is up, then slides it in', () => {
    gameMode.set(true)
    gmStage.set('freezing')
    const node = document.createElement('div')
    const action = gmPanel(node, 'right')
    // Pinned to its own layer for life, starting at the hidden state.
    expect(node.style.transform).toBe('translateZ(0)')
    expect(node.style.opacity).toBe('0')
    expect(node.style.translate).toBe('56px 0px')
    flushFrame()
    flushFrame(100)
    expect(node.style.opacity).toBe('0')
    gmStage.set('frozen')
    flushFrame(GM_PANEL_IN_MS / 2)
    expect(Number(node.style.opacity)).toBeGreaterThan(0)
    flushFrame(GM_PANEL_IN_MS)
    expect(node.style.opacity).toBe('1')
    expect(node.style.translate).toBe('0px 0px')
    action.destroy?.()
  })

  it('slides straight in when the stage is already frozen or not involved', () => {
    gameMode.set(true)
    for (const stage of ['frozen', 'live'] as const) {
      gmStage.set(stage)
      const node = document.createElement('div')
      gmPanel(node, 'bottom')
      expect(node.style.translate).toBe('0px 28px')
      flushFrame()
      flushFrame(GM_PANEL_IN_MS + 16)
      expect(node.style.opacity, stage).toBe('1')
      expect(node.style.translate, stage).toBe('0px 0px')
    }
  })
})

describe('menu stage timing', () => {
  it('mirrors the panel motion on the way out and waits for it before the video returns', () => {
    expect(gmPanelOut()).toEqual({ opacity: [0, 1], x: [56, 0], duration: GM_PANEL_OUT_MS, gameModeOnly: true })
    expect(gmPanelOut('fade')).toEqual({ opacity: [0, 1], duration: GM_PANEL_OUT_MS, gameModeOnly: true })
    expect(GM_THAW_DELAY_MS).toBeGreaterThan(GM_PANEL_OUT_MS)
  })
})
