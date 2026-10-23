import { describe, expect, it } from 'vitest'
import { parsePresentation } from './presentation'

describe('TV block (API 6)', () => {
  it('parses a TV variant with its own navigation, rows, hero, player and preview choice', () => {
    const tv = {
      density: 'large',
      shell: { nav: 'top', top: { labels: 'text' } },
      rows: { defaults: { width: 300, caption: 'focus' } },
      hero: { height: 70 },
      player: { seekbarHeight: 8 },
      cardPreview: 'none',
      layout: { home: [{ role: 'hero' }, { role: 'trending' }] },
    }
    expect(parsePresentation({ tv }).tv).toEqual(tv)
  })

  it('is refused before API 6 and keeps phone-only and nested blocks out', () => {
    expect(() => parsePresentation({ tv: { density: 'large' } }, 5)).toThrow('unsupported')
    expect(() => parsePresentation({ tv: { rootSize: 16 } })).toThrow('unsupported')
    expect(() => parsePresentation({ tv: { mobile: {} } })).toThrow('unsupported')
    expect(() => parsePresentation({ tv: { tv: {} } })).toThrow('unsupported')
    expect(() => parsePresentation({ mobile: { tv: {} } })).toThrow('unsupported')
  })

  it('validates what it carries with the same rules as the top level', () => {
    expect(() => parsePresentation({ tv: { shell: { nav: 'floating' } } })).toThrow('unsupported')
    expect(() => parsePresentation({ tv: { rows: { defaults: { width: 9000 } } } })).toThrow()
  })
})
