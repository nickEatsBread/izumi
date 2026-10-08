import { describe, expect, it } from 'vitest'
import { NAV_DESTINATIONS, parseHomeBlock, parseThemeBlock } from './block-schema'

describe('theme block schema', () => {
  it('accepts a valid block and fills in defaults', () => {
    expect(parseThemeBlock({ block: 'ranked-list', area: 'aside', tabs: [{ label: 'TOP AIRING', role: 'trending' }] }, 3))
      .toEqual({ type: 'ranked-list', area: 'aside', phone: false, tabs: [{ label: 'TOP AIRING', role: 'trending' }], limit: 10 })
    expect(parseThemeBlock({ block: 'genre-chips', genres: 'top' }, 3)).toMatchObject({ type: 'genre-chips', genres: 'top', all: true })
  })

  it('rejects unknown blocks, unknown keys and values it would have to repair', () => {
    expect(() => parseThemeBlock({ block: 'carousel' }, 3)).toThrow('unsupported home block')
    expect(() => parseThemeBlock({ block: 'genre-chips', columns: 3 }, 3)).toThrow('unsupported presentation property')
    expect(() => parseThemeBlock({ block: 'latest-episodes', columns: 40 }, 3)).toThrow('outside the supported range')
    expect(() => parseThemeBlock({ block: 'tabbed-grid', tabs: [{ label: 'A', role: 'x' }, { label: 'A', role: 'y' }] }, 3)).toThrow('outside the supported range')
    expect(() => parseThemeBlock({ block: 'latest-episodes', pagination: 'sideways' }, 3)).toThrow('outside the supported range')
    expect(() => parseThemeBlock('genre-chips', 3)).toThrow()
  })

  it('keeps the lenient repair parser for stored settings', () => {
    expect(parseHomeBlock({ type: 'latest-episodes', columns: 40 })).toMatchObject({ columns: 8 })
    expect(NAV_DESTINATIONS).toContain('library')
  })

  it('adds a caption setting to latest-episodes blocks', () => {
    expect(parseHomeBlock({ type: 'latest-episodes', caption: 'overlay' })).toMatchObject({ caption: 'overlay' })
    expect(parseHomeBlock({ type: 'latest-episodes' })).toMatchObject({ caption: 'below' })
    expect(parseHomeBlock({ type: 'latest-episodes', caption: 'side' })).toMatchObject({ caption: 'below' })
    expect(parseThemeBlock({ block: 'latest-episodes', caption: 'overlay' }, 3)).toMatchObject({ caption: 'overlay' })
    expect(() => parseThemeBlock({ block: 'latest-episodes', caption: 'side' }, 3)).toThrow('outside the supported range')
  })

  it('parses airing-today blocks with a clock and a schedule link', () => {
    expect(parseThemeBlock({ block: 'airing-today', area: 'aside', title: 'Today', limit: 15, clock: true }, 3))
      .toEqual({ type: 'airing-today', title: 'Today', area: 'aside', phone: false, limit: 15, clock: true, more: true })
    expect(parseHomeBlock({ type: 'airing-today', limit: 99, clock: 'yes', more: false })).toMatchObject({ limit: 20, clock: false, more: false })
    expect(() => parseThemeBlock({ block: 'airing-today', clock: 'yes' }, 3)).toThrow('outside the supported range')
    expect(() => parseThemeBlock({ block: 'airing-today', columns: 2 }, 3)).toThrow('unsupported presentation property')
  })

  it('opens a tabbed grid on a chosen tab from theme API 4', () => {
    const tabs = [{ label: 'TRENDING', role: 'trending' }, { label: 'POPULAR', role: 'popular' }, { label: 'TOP', role: 'top' }]
    expect(parseThemeBlock({ block: 'tabbed-grid', tabs, default: 1 }, 4)).toMatchObject({ type: 'tabbed-grid', tabs, default: 1 })
    expect(parseThemeBlock({ block: 'tabbed-grid', tabs, default: 0 }, 4)).toMatchObject({ default: 0 })
    expect(() => parseThemeBlock({ block: 'tabbed-grid', tabs, default: 1 }, 3)).toThrow('unsupported presentation property')
    for (const value of [3, -1, 1.5, '1', null]) {
      expect(() => parseThemeBlock({ block: 'tabbed-grid', tabs, default: value }, 4), String(value)).toThrow('outside the supported range')
    }
    // Stored settings are repaired into range.
    expect(parseHomeBlock({ type: 'tabbed-grid', tabs, default: 9 })).toMatchObject({ default: 2 })
    expect(parseHomeBlock({ type: 'tabbed-grid', tabs: [], default: 2 })).toMatchObject({ default: 0 })
    expect(parseHomeBlock({ type: 'tabbed-grid', tabs, default: 'second' })).toMatchObject({ default: 0 })
  })

  it('draws artwork on profile-header buttons that ask for it, from theme API 4', () => {
    const buttons = [{ label: 'Lists', to: 'library', art: true }, { label: 'Search', to: 'search' }, { label: 'Plain', to: 'schedule', art: false }]
    expect(parseThemeBlock({ block: 'profile-header', buttons }, 4)).toMatchObject({ type: 'profile-header', buttons })
    expect(() => parseThemeBlock({ block: 'profile-header', buttons }, 3)).toThrow('unsupported presentation property')
    expect(() => parseThemeBlock({ block: 'profile-header', buttons: [{ label: 'Lists', to: 'library', art: 'yes' }] }, 4)).toThrow('outside the supported range')
    // Older packages keep their plain buttons; stored settings drop a value that is not a flag.
    expect(parseThemeBlock({ block: 'profile-header', buttons: [{ label: 'Lists', to: 'library' }] }, 3)).toMatchObject({ buttons: [{ label: 'Lists', to: 'library' }] })
    expect(parseHomeBlock({ type: 'profile-header', buttons: [{ label: 'Lists', to: 'library', art: 1 }] })).toMatchObject({ buttons: [{ label: 'Lists', to: 'library' }] })
    expect((parseHomeBlock({ type: 'profile-header', buttons: [{ label: 'Lists', to: 'library', art: 1 }] }) as { buttons: object[] }).buttons[0]).not.toHaveProperty('art')
  })

  // A package installed under an older API is stored as parsed, then re-read against that API: a block
  // that never named an opening tab must not gain one on the way through.
  it('adds no opening tab to a tabbed grid that never named one', () => {
    const block = parseThemeBlock({ block: 'tabbed-grid', tabs: [{ label: 'A', role: 'trending' }] }, 3)
    expect(block).not.toHaveProperty('default')
    expect(parseHomeBlock({ type: 'tabbed-grid' })).not.toHaveProperty('default')
    const { type, ...settings } = block
    expect(parseThemeBlock({ block: type, ...settings }, 3)).toEqual(block)
  })
})
