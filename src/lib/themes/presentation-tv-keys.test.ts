import { describe, expect, it } from 'vitest'
import { parsePresentation, resolvePlayerControls, resolvePresentation, resolveRow, resolveSearch } from './presentation'

const captionTemplate = { type: 'stack', children: [{ type: 'text', field: 'genres' }, { type: 'text', field: 'description', style: { lines: 2 } }] }

describe('row focus and caption template (API 6)', () => {
  it('parses an anchored focus and a caption template on the defaults and on a row', () => {
    const rows = { defaults: { focus: 'anchor', caption: 'focus', captionTemplate }, byId: { trending: { focus: 'default' } } }
    expect(parsePresentation({ rows }).rows).toEqual(rows)
    expect(parsePresentation({ tv: { rows } }).tv?.rows).toEqual(rows)
  })

  it('refuses both before API 6 and refuses unknown values', () => {
    expect(() => parsePresentation({ rows: { defaults: { focus: 'anchor' } } }, 5)).toThrow('unsupported')
    expect(() => parsePresentation({ rows: { defaults: { captionTemplate } } }, 5)).toThrow('unsupported')
    expect(() => parsePresentation({ rows: { byId: { trending: { focus: 'anchor' } } } }, 5)).toThrow('unsupported')
    expect(() => parsePresentation({ rows: { defaults: { focus: 'center' } } })).toThrow('unsupported')
  })

  it('refuses actions in a caption template, as in a card template', () => {
    expect(() => parsePresentation({ rows: { defaults: { captionTemplate: { type: 'action', action: 'play' } } } })).toThrow('nested actions')
    expect(() => parsePresentation({ rows: { defaults: { captionTemplate: { type: 'stack', children: [{ type: 'action', action: 'play' }] } } } })).toThrow('nested actions')
  })

  it('resolves the defaults and a per-row entry over them', () => {
    const layout = parsePresentation({ rows: { defaults: { focus: 'anchor', captionTemplate }, byId: { trending: { focus: 'default' } } } })
    expect(resolveRow(layout, 'continue')).toMatchObject({ focus: 'anchor', captionTemplate })
    expect(resolveRow(layout, 'trending')).toMatchObject({ focus: 'default', captionTemplate })
    expect(resolveRow(undefined)).toEqual({})
  })
})

describe('grid search keyboard (API 6, TV block only)', () => {
  it('parses inside the TV block', () => {
    expect(parsePresentation({ tv: { search: { keyboard: 'grid' } } }).tv?.search).toEqual({ keyboard: 'grid' })
    expect(parsePresentation({ tv: { search: { keyboard: 'default' } } }).tv?.search).toEqual({ keyboard: 'default' })
    expect(parsePresentation({ tv: { search: {} } }).tv?.search).toEqual({})
  })

  it('is refused before API 6, at the top level, in the phone block and for unknown values', () => {
    expect(() => parsePresentation({ tv: { search: { keyboard: 'grid' } } }, 5)).toThrow('unsupported')
    expect(() => parsePresentation({ search: { keyboard: 'grid' } })).toThrow('unsupported')
    expect(() => parsePresentation({ mobile: { search: { keyboard: 'grid' } } })).toThrow('unsupported')
    expect(() => parsePresentation({ tv: { search: { keyboard: 'qwerty' } } })).toThrow('unsupported')
    expect(() => parsePresentation({ tv: { search: { layout: 'grid' } } })).toThrow('unsupported')
  })

  it('resolves on a TV surface only, and defaults to the izumi keyboard', () => {
    const layout = parsePresentation({ density: 'compact', tv: { search: { keyboard: 'grid' } } })
    expect(resolvePresentation(layout, false, true)?.search).toEqual({ keyboard: 'grid' })
    expect(resolvePresentation(layout, false, false)?.search).toBeUndefined()
    expect(resolvePresentation(layout, true, true)?.search).toBeUndefined()
    expect(resolveSearch(resolvePresentation(layout, false, true))).toEqual({ keyboard: 'grid' })
    expect(resolveSearch(resolvePresentation(layout, false))).toEqual({ keyboard: 'default' })
    expect(resolveSearch(undefined)).toEqual({ keyboard: 'default' })
  })

  it('survives a TV block that carries nothing else', () => {
    const tvOnly = parsePresentation({ tv: { search: { keyboard: 'grid' } } })
    expect(resolvePresentation(tvOnly, false)).toEqual({})
    expect(resolvePresentation(tvOnly, false, true)).toEqual({ search: { keyboard: 'grid' } })
  })
})

describe('player buttons (API 6)', () => {
  it('parses the two buttons in the theme order', () => {
    expect(parsePresentation({ player: { buttons: ['restart', 'next'] } }).player?.buttons).toEqual(['restart', 'next'])
    expect(parsePresentation({ player: { buttons: ['next'] } }).player?.buttons).toEqual(['next'])
    expect(parsePresentation({ player: { buttons: [] } }).player?.buttons).toEqual([])
    expect(parsePresentation({ tv: { player: { buttons: ['next', 'restart'] } } }).tv?.player?.buttons).toEqual(['next', 'restart'])
  })

  it('is refused before API 6, and refuses duplicates, unknown names and non-lists', () => {
    expect(() => parsePresentation({ player: { buttons: ['restart'] } }, 5)).toThrow('unsupported')
    expect(() => parsePresentation({ player: { buttons: ['restart', 'restart'] } })).toThrow('twice')
    expect(() => parsePresentation({ player: { buttons: ['previous'] } })).toThrow('unsupported')
    expect(() => parsePresentation({ player: { buttons: ['restart', 'next', 'next'] } })).toThrow()
    expect(() => parsePresentation({ player: { buttons: 'restart' } })).toThrow()
  })

  it('resolves to none by default, and the TV block can change it', () => {
    expect(resolvePlayerControls(undefined).buttons).toEqual([])
    const layout = parsePresentation({ player: { buttons: ['next'] }, tv: { player: { buttons: ['restart', 'next'] } } })
    expect(resolvePlayerControls(resolvePresentation(layout, false)).buttons).toEqual(['next'])
    expect(resolvePlayerControls(resolvePresentation(layout, false, true)).buttons).toEqual(['restart', 'next'])
  })
})
