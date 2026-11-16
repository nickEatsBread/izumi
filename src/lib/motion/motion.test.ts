// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { motionPreference } from '$lib/settings/ui'
import { motion, motionCss, motionFrame } from './motion'

afterEach(() => {
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
  it('is an ordinary CSS transition, never script-driven', () => {
    const node = document.createElement('div')
    const config = motion(node, { opacity: [0, 1], duration: 150 }) as { css?: (t: number) => string; tick?: unknown; duration: number }
    expect(config.duration).toBe(150)
    expect(config.css?.(0.5)).toBe('opacity: 0.5')
    expect(config.tick).toBeUndefined()
    expect(node.style.transform).toBe('')
  })

  it('skips all motion when it is reduced', () => {
    motionPreference.set('reduce')
    expect(motion(document.createElement('div'), { opacity: [0, 1] })).toEqual({ duration: 0 })
  })
})
