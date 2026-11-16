import { describe, expect, it } from 'vitest'
import { parsePresentation, resolvePresentation, themeCoverage, withPlayerTheme } from './presentation'
import { beginLoading, endLoading, HANDOVER_MS } from './loading-clock'

const template = { type: 'overlay', children: [{ type: 'artwork', artwork: 'backdrop', part: 'loader-art' }, { type: 'text', field: 'title', part: 'loader-title' }] }

describe('loading screens (API 8)', () => {
  it('parses a template and an exit for each moment on API 8 packages only', () => {
    const loading = { title: { template, exit: 300 }, episode: { template, exit: 0 } }
    expect(parsePresentation({ loading }, 8).loading).toEqual(loading)
    expect(() => parsePresentation({ loading }, 7)).toThrow('unsupported')
    expect(() => parsePresentation({ mobile: { loading } }, 7)).toThrow('unsupported')
    expect(() => parsePresentation({ tv: { loading } }, 7)).toThrow('unsupported')
  })
  it('holds the exit to whole milliseconds between 0 and 1000', () => {
    expect(parsePresentation({ loading: { title: { exit: 1000 } } }).loading?.title?.exit).toBe(1000)
    for (const exit of [-1, 1001, 12.5, '300']) expect(() => parsePresentation({ loading: { title: { exit } } })).toThrow()
  })
  it('keeps the templates display-only and refuses unknown moments and keys', () => {
    expect(() => parsePresentation({ loading: { episode: { template: { type: 'action', action: 'play' } } } })).toThrow('actions')
    expect(() => parsePresentation({ loading: { player: { template } } })).toThrow()
    expect(() => parsePresentation({ loading: { title: { template, delay: 180 } } })).toThrow()
  })
  it('layers the phone and TV blocks one screen at a time', () => {
    const shared = parsePresentation({ loading: { title: { template, exit: 300 }, episode: { exit: 200 } }, mobile: { loading: { title: { exit: 0 } } }, tv: { loading: { episode: { template } } } })
    expect(resolvePresentation(shared, true)?.loading).toEqual({ title: { exit: 0 }, episode: { exit: 200 } })
    expect(resolvePresentation(shared, false, true)?.loading).toEqual({ title: { template, exit: 300 }, episode: { template } })
    expect(resolvePresentation(shared, false)?.loading?.title?.exit).toBe(300)
  })
  it("gives the episode screen to the player theme and keeps the title page's with the app theme", () => {
    const app = parsePresentation({ loading: { title: { template, exit: 300 }, episode: { exit: 100 } } })
    const player = parsePresentation({ loading: { title: { exit: 900 }, episode: { template, exit: 0 } } })
    expect(withPlayerTheme(app, player)?.loading).toEqual({ title: { template, exit: 300 }, episode: { template, exit: 0 } })
    // A palette as the player theme: izumi's own ring, never the app theme's episode screen.
    expect(withPlayerTheme(app, undefined)?.loading).toEqual({ title: { template, exit: 300 } })
  })
  it('counts the title screen as Details and the episode screen as Player', () => {
    expect(themeCoverage(parsePresentation({ loading: { title: { template } } }))).toEqual(['Details'])
    expect(themeCoverage(parsePresentation({ loading: { episode: { template } } }))).toEqual(['Player'])
  })
})

describe('loading clock', () => {
  it('starts a wait at zero and continues it across a hand-over', () => {
    expect(beginLoading('title', 1_000_000)).toBe('0ms')
    endLoading('title', 1_002_000)
    // The next screen is another wait.
    expect(beginLoading('title', 1_002_000 + HANDOVER_MS + 1)).toBe('0ms')
    endLoading('title', 1_010_000)
    expect(beginLoading('episode', 2_000_000)).toBe('0ms')
    // Opening screen and player cover both up, then the opening screen goes.
    expect(beginLoading('episode', 2_001_500)).toBe('-1500ms')
    endLoading('episode', 2_002_000)
    endLoading('episode', 2_003_000)
    // The player's cover remounting right after (a source change) keeps the same wait.
    expect(beginLoading('episode', 2_003_000 + HANDOVER_MS)).toBe(`-${1_000 + 2_000 + HANDOVER_MS}ms`)
    endLoading('episode', 2_010_000)
  })
})
