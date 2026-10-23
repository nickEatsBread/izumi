import { describe, expect, it } from 'vitest'
import { parsePresentation, resolveDetail, resolvePresentation } from './presentation'

describe('motion keys (API 6)', () => {
  it('parses expand previews and trailer backgrounds', () => {
    const layout = parsePresentation({ cardPreview: 'expand', hero: { preview: 'trailer' }, detail: { preview: 'trailer' } })
    expect(layout.cardPreview).toBe('expand')
    expect(layout.hero?.preview).toBe('trailer')
    expect(layout.detail?.preview).toBe('trailer')
    expect(parsePresentation({ hero: { preview: 'none' }, detail: { preview: 'none' } })).toMatchObject({ hero: { preview: 'none' }, detail: { preview: 'none' } })
  })

  it('the series page reads its trailer switch through resolveDetail', () => {
    expect(resolveDetail(parsePresentation({ detail: { preview: 'trailer' } })).preview).toBe('trailer')
    expect(resolveDetail(parsePresentation({})).preview).toBeUndefined()
  })

  it('accepts a trailer artwork node in a hero template', () => {
    const template = { type: 'overlay', children: [{ type: 'artwork', artwork: 'backdrop' }, { type: 'artwork', artwork: 'trailer', part: 'hero.trailer' }] }
    expect(parsePresentation({ hero: { template } }).hero?.template?.children?.[1]).toEqual({ type: 'artwork', artwork: 'trailer', part: 'hero.trailer' })
  })

  it('refuses them before API 6', () => {
    expect(() => parsePresentation({ cardPreview: 'expand' }, 5)).toThrow('unsupported')
    expect(() => parsePresentation({ hero: { preview: 'trailer' } }, 5)).toThrow('unsupported')
    expect(() => parsePresentation({ detail: { preview: 'trailer' } }, 5)).toThrow('unsupported')
    expect(() => parsePresentation({ hero: { template: { type: 'artwork', artwork: 'trailer' } } }, 5)).toThrow('unsupported')
    expect(parsePresentation({ cardPreview: 'none' }, 5).cardPreview).toBe('none')
    expect(() => parsePresentation({ hero: { template: { type: 'text', text: 'x', when: { field: 'trailer' } } } })).toThrow('unsupported')
  })

  it('refuses unknown values', () => {
    expect(() => parsePresentation({ cardPreview: 'zoom' })).toThrow('unsupported')
    expect(() => parsePresentation({ hero: { preview: 'video' } })).toThrow('unsupported')
  })

  it('the TV block may switch the preview off again', () => {
    const layout = parsePresentation({ cardPreview: 'expand', tv: { cardPreview: 'none' } })
    expect(resolvePresentation(layout, false)?.cardPreview).toBe('expand')
    expect(resolvePresentation(layout, false, true)?.cardPreview).toBe('none')
  })
})
