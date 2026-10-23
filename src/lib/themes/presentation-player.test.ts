import { describe, expect, it } from 'vitest'
import { parsePresentation, resolvePlayerControls, resolvePresentation } from './presentation'

describe('player controls (API 6)', () => {
  it('parses the four keys', () => {
    const player = { seekButtons: true, time: 'remaining', title: 'episode', paused: 'summary' }
    expect(parsePresentation({ player }).player).toEqual(player)
    for (const time of ['default', 'remaining', 'split']) expect(parsePresentation({ player: { time } }).player?.time).toBe(time)
    expect(parsePresentation({ player: { title: 'default', paused: 'none' } }).player).toEqual({ title: 'default', paused: 'none' })
  })

  it('refuses them before API 6 and refuses unknown values', () => {
    for (const player of [{ seekButtons: true }, { time: 'remaining' }, { title: 'episode' }, { paused: 'summary' }]) {
      expect(() => parsePresentation({ player }, 5)).toThrow('unsupported')
    }
    expect(() => parsePresentation({ player: { time: 'left' } })).toThrow('unsupported')
    expect(() => parsePresentation({ player: { seekButtons: 'yes' } })).toThrow()
  })

  it('resolves defaults, and the TV block can change them', () => {
    expect(resolvePlayerControls(undefined)).toEqual({ seekButtons: false, time: 'default', title: 'default', paused: 'none', buttons: [] })
    const layout = parsePresentation({ player: { time: 'remaining' }, tv: { player: { time: 'split', paused: 'summary' } } })
    expect(resolvePlayerControls(resolvePresentation(layout, false))).toMatchObject({ time: 'remaining', paused: 'none' })
    expect(resolvePlayerControls(resolvePresentation(layout, false, true))).toMatchObject({ time: 'split', paused: 'summary' })
  })
})
