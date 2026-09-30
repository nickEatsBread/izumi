import { describe, expect, it } from 'vitest'
import { NAV_DESTINATIONS, parseHomeBlock, parseThemeBlock } from './block-schema'

describe('theme block schema', () => {
  it('accepts a valid block and fills in defaults', () => {
    expect(parseThemeBlock({ block: 'ranked-list', area: 'aside', tabs: [{ label: 'TOP AIRING', role: 'trending' }] }))
      .toEqual({ type: 'ranked-list', area: 'aside', phone: false, tabs: [{ label: 'TOP AIRING', role: 'trending' }], limit: 10 })
    expect(parseThemeBlock({ block: 'genre-chips', genres: 'top' })).toMatchObject({ type: 'genre-chips', genres: 'top', all: true })
  })

  it('rejects unknown blocks, unknown keys and values it would have to repair', () => {
    expect(() => parseThemeBlock({ block: 'carousel' })).toThrow('unsupported home block')
    expect(() => parseThemeBlock({ block: 'genre-chips', columns: 3 })).toThrow('unsupported presentation property')
    expect(() => parseThemeBlock({ block: 'latest-episodes', columns: 40 })).toThrow('outside the supported range')
    expect(() => parseThemeBlock({ block: 'tabbed-grid', tabs: [{ label: 'A', role: 'x' }, { label: 'A', role: 'y' }] })).toThrow('outside the supported range')
    expect(() => parseThemeBlock({ block: 'latest-episodes', pagination: 'sideways' })).toThrow('outside the supported range')
    expect(() => parseThemeBlock('genre-chips')).toThrow()
  })

  it('keeps the lenient repair parser for stored settings', () => {
    expect(parseHomeBlock({ type: 'latest-episodes', columns: 40 })).toMatchObject({ columns: 8 })
    expect(NAV_DESTINATIONS).toContain('library')
  })

  it('adds a caption setting to latest-episodes blocks', () => {
    expect(parseHomeBlock({ type: 'latest-episodes', caption: 'overlay' })).toMatchObject({ caption: 'overlay' })
    expect(parseHomeBlock({ type: 'latest-episodes' })).toMatchObject({ caption: 'below' })
    expect(parseHomeBlock({ type: 'latest-episodes', caption: 'side' })).toMatchObject({ caption: 'below' })
    expect(parseThemeBlock({ block: 'latest-episodes', caption: 'overlay' })).toMatchObject({ caption: 'overlay' })
    expect(() => parseThemeBlock({ block: 'latest-episodes', caption: 'side' })).toThrow('outside the supported range')
  })

  it('parses airing-today blocks with a clock and a schedule link', () => {
    expect(parseThemeBlock({ block: 'airing-today', area: 'aside', title: 'Today', limit: 15, clock: true }))
      .toEqual({ type: 'airing-today', title: 'Today', area: 'aside', phone: false, limit: 15, clock: true, more: true })
    expect(parseHomeBlock({ type: 'airing-today', limit: 99, clock: 'yes', more: false })).toMatchObject({ limit: 20, clock: false, more: false })
    expect(() => parseThemeBlock({ block: 'airing-today', clock: 'yes' })).toThrow('outside the supported range')
    expect(() => parseThemeBlock({ block: 'airing-today', columns: 2 })).toThrow('unsupported presentation property')
  })
})
