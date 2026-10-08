// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { gameMode } from '$lib/player/session'
import { motionPreference } from '$lib/settings/ui'
import { motion, motionCss, motionFrame } from './gm-motion'

afterEach(() => {
  gameMode.set(false)
  motionPreference.set('system')
})

describe('motionFrame', () => {
  it('interpolates every channel from hidden to shown', () => {
    const p = { opacity: [0, 0.7], xPercent: [3, 0], scale: [1.015, 1] } as const
    expect(motionFrame(p, 0)).toEqual({ opacity: 0, translate: '3% 0px', scale: 1.015 })
    expect(motionFrame(p, 1)).toEqual({ opacity: 0.7, translate: '0% 0px', scale: 1 })
    expect(motionFrame({ y: [-5, 0] }, 0.5)).toEqual({ translate: '0px -2.5px' })
  })

  it('writes individual transform properties, never `transform`', () => {
    expect(motionCss(motionFrame({ opacity: [0, 1], y: [20, 0], scale: [0.9, 1] }, 0)))
      .toBe('opacity: 0; translate: 0px 20px; scale: 0.9')
  })
})

describe('motion', () => {
  it('is an ordinary CSS transition outside Game mode', () => {
    const node = document.createElement('div')
    const config = motion(node, { opacity: [0, 1], duration: 150 }) as { css?: (t: number) => string; tick?: unknown; duration: number }
    expect(config.duration).toBe(150)
    expect(config.css?.(0.5)).toBe('opacity: 0.5')
    expect(config.tick).toBeUndefined()
    expect(node.style.transform).toBe('')
  })

  it('runs from script on a pinned layer in Game mode, starting an intro at its hidden state', () => {
    gameMode.set(true)
    const node = document.createElement('div')
    const config = motion(node, { opacity: [0, 1], y: [-5, 0], duration: 150 }, { direction: 'in' }) as { css?: unknown; tick: (t: number) => void }
    expect(config.css).toBeUndefined()
    // The anchor that keeps the element composited for its whole life.
    expect(node.style.transform).toBe('translateZ(0)')
    expect(node.style.opacity).toBe('0')
    config.tick(1)
    expect(node.style.opacity).toBe('1')
    expect(node.style.translate).toBe('0px 0px')
  })

  it('leaves an outro at its shown state until it runs', () => {
    gameMode.set(true)
    const node = document.createElement('div')
    motion(node, { opacity: [0, 1] }, { direction: 'out' })
    expect(node.style.opacity).toBe('')
  })

  it('skips Game-mode-only motion elsewhere, and all motion when it is reduced', () => {
    expect(motion(document.createElement('div'), { gameModeOnly: true, opacity: [0, 1] })).toEqual({ duration: 0 })
    gameMode.set(true)
    motionPreference.set('reduce')
    expect(motion(document.createElement('div'), { opacity: [0, 1] })).toEqual({ duration: 0 })
    vi.restoreAllMocks()
  })
})
