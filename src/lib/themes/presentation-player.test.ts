import { describe, expect, it } from 'vitest'
import { parsePresentation, resolvePlayerControls, resolvePresentation, withPlayerTheme } from './presentation'

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

  it('takes the whole window for the player only when asked', () => {
    expect(parsePresentation({ player: { window: 'full' } }).player).toEqual({ window: 'full' })
    expect(() => parsePresentation({ player: { window: 'full' } }, 5)).toThrow('unsupported')
    expect(() => parsePresentation({ player: { window: 'fullscreen' } })).toThrow('unsupported')
    expect(resolvePlayerControls(parsePresentation({ player: { window: 'full' } })).window).toBe('full')
  })

  it('resolves defaults, and the TV block can change them', () => {
    expect(resolvePlayerControls(undefined)).toEqual({ seekButtons: false, time: 'default', title: 'default', paused: 'none', buttons: [], window: 'app', trackButtons: 'icon', rating: 'none', endTime: false })
    const layout = parsePresentation({ player: { time: 'remaining' }, tv: { player: { time: 'split', paused: 'summary' } } })
    expect(resolvePlayerControls(resolvePresentation(layout, false))).toMatchObject({ time: 'remaining', paused: 'none' })
    expect(resolvePlayerControls(resolvePresentation(layout, false, true))).toMatchObject({ time: 'split', paused: 'summary' })
  })
})

describe('API 7 player keys', () => {
  it('names the track buttons in words and shows the rating card when asked', () => {
    const layout = parsePresentation({ player: { trackButtons: 'text', rating: 'intro' } }, 7)
    expect(resolvePlayerControls(layout)).toMatchObject({ trackButtons: 'text', rating: 'intro' })
  })
  it('refuses them before API 7 and refuses unknown values', () => {
    expect(() => parsePresentation({ player: { trackButtons: 'text' } }, 6)).toThrow()
    expect(() => parsePresentation({ player: { rating: 'always' } }, 7)).toThrow()
  })
  it('adds the framing button and the end time, refused before API 7', () => {
    const player = { buttons: ['fit', 'restart'], endTime: true }
    expect(parsePresentation({ player }).player).toEqual(player)
    expect(resolvePlayerControls(parsePresentation({ player }))).toMatchObject({ buttons: ['fit', 'restart'], endTime: true })
    expect(() => parsePresentation({ player: { buttons: ['fit'] } }, 6)).toThrow()
    expect(() => parsePresentation({ player: { endTime: true } }, 6)).toThrow('unsupported')
    expect(parsePresentation({ player: { buttons: ['restart'] } }, 6).player).toEqual({ buttons: ['restart'] })
  })
})

describe('player theme (API 8 client setting)', () => {
  const app = parsePresentation({ shell: { nav: 'top' }, density: 'compact', player: { time: 'split', layout: 'docked' } })
  it('takes the player keys from the player theme and everything else from the app theme', () => {
    const merged = withPlayerTheme(app, parsePresentation({ shell: { nav: 'drawer' }, player: { time: 'remaining' } }))
    expect(merged?.shell?.nav).toBe('top')
    expect(merged?.density).toBe('compact')
    expect(merged?.player).toEqual({ time: 'remaining' })
  })
  it("gives izumi's own player when the player theme has none (a palette)", () => {
    expect(withPlayerTheme(app, undefined)?.player).toBeUndefined()
    expect(withPlayerTheme(app, undefined)?.shell?.nav).toBe('top')
    expect(withPlayerTheme(undefined, undefined)).toBeUndefined()
    expect(withPlayerTheme(undefined, parsePresentation({ player: { endTime: true } }))).toEqual({ player: { endTime: true } })
  })
})
