import { describe, expect, it } from 'vitest'
import { displayText, parseNode, parsePresentation, resolveDetail, resolvePresentation } from './presentation'

// Theme API 4 keys for the phone replicas' last client gaps: the kind of title, the studio button,
// plain status words and aired episode counts, recommendations among the relations, the series
// progress row, the folding actions row and the hero's artwork choice.
describe('client gap keys (API 4)', () => {
  it('binds the kind of title as a field from API 4', () => {
    const node = { type: 'row', children: [{ type: 'text', field: 'kind', when: { field: 'kind' } }, { type: 'text', field: 'genre' }] }
    expect(parseNode(node)).toEqual(node)
    expect(displayText('kind', { kind: 'Series' })).toBe('Series')
    expect(() => parseNode({ type: 'text', field: 'kind' }, undefined, 0, false, 3)).toThrow('unsupported')
    expect(() => parseNode({ type: 'text', when: { field: 'kind', atMost: 1 } })).toThrow('numeric')
  })

  it('accepts the studio button in the series header and facts templates only', () => {
    const studio = { type: 'action', action: 'studio', part: 'theme.studio' }
    const header = { type: 'row', children: [studio, { type: 'text', field: 'year' }] }
    expect(parsePresentation({ detail: { header } }).detail?.header).toEqual(header)
    expect(parsePresentation({ detail: { facts: { type: 'stack', children: [studio] } } }).detail?.facts).toEqual({ type: 'stack', children: [studio] })
    // The header holds no other action, and older packages keep a header without any.
    expect(() => parsePresentation({ detail: { header: { type: 'action', action: 'trailer' } } })).toThrow('unsupported')
    expect(() => parsePresentation({ detail: { header: studio } }, 3)).toThrow('nested actions')
    expect(() => parsePresentation({ detail: { facts: studio } }, 3)).toThrow('unsupported')
    // Elsewhere there is no studio to open.
    expect(() => parsePresentation({ hero: { template: studio } })).toThrow('unsupported')
    expect(() => parsePresentation({ detail: { actionsLead: studio } })).toThrow('nested actions')
    expect(() => parsePresentation({ cards: { poster: studio } })).toThrow('nested actions')
  })

  it('parses plain status words and aired episode counts', () => {
    const factsFormat = { status: 'plain', episodes: 'aired-of' }
    expect(parsePresentation({ detail: { factsFormat } }).detail?.factsFormat).toEqual(factsFormat)
    for (const episodes of ['total', 'aired', 'aired-of']) expect(parsePresentation({ detail: { factsFormat: { episodes } } }).detail?.factsFormat?.episodes).toBe(episodes)
    expect(parsePresentation({ detail: { factsFormat: { status: 'catalog' } } }).detail?.factsFormat?.status).toBe('catalog')
    expect(() => parsePresentation({ detail: { factsFormat: { status: 'ongoing' } } })).toThrow('unsupported')
    expect(() => parsePresentation({ detail: { factsFormat: { episodes: 'aired-total' } } })).toThrow('unsupported')
    expect(() => parsePresentation({ detail: { factsFormat: { status: 'plain' } } }, 3)).toThrow('unsupported')
    // A phone format merges over the shared one key by key.
    const layout = parsePresentation({ detail: { factsFormat: { status: 'plain', dates: 'long' } }, mobile: { detail: { factsFormat: { episodes: 'aired' } } } })
    expect(resolveDetail(resolvePresentation(layout, true)).factsFormat).toEqual({ status: 'plain', dates: 'long', episodes: 'aired' })
  })

  it('appends the recommendations to the relations, never beside a tab of their own', () => {
    const sections = { tabs: ['overview', 'relations'], relations: { recommended: 'append' } }
    expect(parsePresentation({ detail: { sections } }).detail?.sections).toEqual(sections)
    expect(parsePresentation({ detail: { sections: { relations: { recommended: 'separate' } } } }).detail?.sections?.relations).toEqual({ recommended: 'separate' })
    expect(parsePresentation({ detail: { sections: { relations: {} } } }).detail?.sections?.relations).toEqual({})
    expect(() => parsePresentation({ detail: { sections: { tabs: ['relations', 'recommended'], relations: { recommended: 'append' } } } })).toThrow('cannot give them a tab')
    expect(() => parsePresentation({ detail: { sections: { default: 'recommended', relations: { recommended: 'append' } } } })).toThrow('cannot give them a tab')
    expect(() => parsePresentation({ detail: { sections: { relations: { recommended: 'merge' } } } })).toThrow('unsupported')
    expect(() => parsePresentation({ detail: { sections: { relations: { chain: true } } } })).toThrow('unsupported')
    expect(() => parsePresentation({ detail: { sections: { relations: { recommended: 'append' } } } }, 3)).toThrow('unsupported')
  })

  it('parses the series progress row and the folding actions row', () => {
    const detail = { progress: 'row', actions: 'expand' }
    expect(parsePresentation({ detail }).detail).toEqual(detail)
    expect(resolveDetail(parsePresentation({ detail }))).toMatchObject(detail)
    expect(resolveDetail(parsePresentation({ detail: { progress: 'none', actions: 'row' } }))).toMatchObject({ progress: 'none', actions: 'row' })
    expect(resolveDetail(undefined)).toMatchObject({ progress: undefined, actions: undefined })
    expect(() => parsePresentation({ detail: { progress: 'bar' } })).toThrow('unsupported')
    expect(() => parsePresentation({ detail: { actions: 'menu' } })).toThrow('unsupported')
    expect(() => parsePresentation({ detail: { progress: 'row' } }, 3)).toThrow('unsupported')
    expect(() => parsePresentation({ detail: { actions: 'expand' } }, 3)).toThrow('unsupported')
  })

  it("parses the hero's artwork choice", () => {
    expect(parsePresentation({ hero: { art: 'banner-cover' } }).hero).toEqual({ art: 'banner-cover' })
    expect(parsePresentation({ hero: { art: 'banner' } }).hero?.art).toBe('banner')
    expect(() => parsePresentation({ hero: { art: 'trailer' } })).toThrow('unsupported')
    expect(() => parsePresentation({ hero: { art: 'banner-cover' } }, 3)).toThrow('unsupported')
    const layout = parsePresentation({ hero: { art: 'banner' }, mobile: { hero: { art: 'banner-cover' } } })
    expect(resolvePresentation(layout, true)?.hero?.art).toBe('banner-cover')
    expect(resolvePresentation(layout, false)?.hero?.art).toBe('banner')
  })

  it('serialises the new keys to exactly what the parser accepts', () => {
    const presentation = {
      hero: { art: 'banner-cover' },
      detail: {
        header: { type: 'row', children: [{ type: 'action', action: 'studio', icon: 'studio' }, { type: 'text', field: 'kind' }] },
        factsFormat: { status: 'plain', episodes: 'aired-of' }, progress: 'row', actions: 'expand',
        sections: { tabs: ['episodes', 'relations', 'overview'], relations: { recommended: 'append' } },
      },
    }
    const parsed = parsePresentation(presentation)
    expect(parsed).toEqual(presentation)
    expect(parsePresentation(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed)
  })
})
