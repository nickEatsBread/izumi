import { describe, expect, it } from 'vitest'
import { parsePresentation, resolveDetail, resolvePresentation } from './presentation'

// API 4 `detail.episodes.seasonsScroll`: where the season chips or posters open. The per-episode
// `download` key's own parser tests sit with the other API 4 keys in presentation.test.ts.
describe('the season row opening position (API 4)', () => {
  it('parses both positions and passes them through resolveDetail', () => {
    for (const seasonsScroll of ['active', 'start'] as const) {
      const layout = parsePresentation({ detail: { episodes: { seasons: 'chips', seasonsScroll } } })
      expect(layout.detail?.episodes).toEqual({ seasons: 'chips', seasonsScroll })
      expect(resolveDetail(layout).episodes?.seasonsScroll).toBe(seasonsScroll)
    }
    // Without the key the row keeps opening on the current season (the picker's own default).
    expect(resolveDetail(undefined).episodes?.seasonsScroll).toBeUndefined()
  })

  it('is refused on API 3 packages and takes only its two values', () => {
    expect(() => parsePresentation({ detail: { episodes: { seasonsScroll: 'start' } } }, 3)).toThrow('unsupported')
    expect(parsePresentation({ detail: { episodes: { seasonsScroll: 'start' } } }, 4).detail?.episodes?.seasonsScroll).toBe('start')
    for (const seasonsScroll of ['first', 'centre', true, 0]) {
      expect(() => parsePresentation({ detail: { episodes: { seasonsScroll } } }), String(seasonsScroll)).toThrow()
    }
  })

  it('merges a phone value over the shared episode keys', () => {
    const layout = parsePresentation({ detail: { episodes: { seasons: 'chips', download: 'button' } }, mobile: { detail: { episodes: { seasonsScroll: 'start' } } } })
    expect(resolveDetail(resolvePresentation(layout, true)).episodes).toMatchObject({ seasons: 'chips', download: 'button', seasonsScroll: 'start' })
    expect(resolveDetail(resolvePresentation(layout, false)).episodes?.seasonsScroll).toBeUndefined()
  })

  it('round-trips through JSON with the download key', () => {
    const parsed = parsePresentation({ detail: { episodes: { download: 'button', seasonsScroll: 'start' } } })
    expect(parsePresentation(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed)
  })
})
