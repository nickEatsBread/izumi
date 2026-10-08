import { describe, expect, it } from 'vitest'
import type { Media } from '$lib/anilist/types'
import { recommendedTitles, relationMedia } from './relations'

describe('the kind of a related title', () => {
  it('names anime, manga, light novels and one-shots', () => {
    expect(relationMedia({ type: 'ANIME', format: 'TV' })).toBe('anime')
    expect(relationMedia({ type: 'ANIME', format: 'MOVIE' })).toBe('anime')
    expect(relationMedia({ type: 'MANGA', format: 'MANGA' })).toBe('manga')
    expect(relationMedia({ type: 'MANGA', format: 'NOVEL' })).toBe('novel')
    expect(relationMedia({ type: 'MANGA', format: 'ONE_SHOT' })).toBe('one-shot')
  })
  it('reads the format alone on a record without its type', () => {
    expect(relationMedia({ format: 'NOVEL' })).toBe('novel')
    expect(relationMedia({ format: 'MANGA' })).toBe('manga')
    expect(relationMedia({ format: 'OVA' })).toBe('anime')
    expect(relationMedia({})).toBeUndefined()
  })
})

describe('the recommended titles', () => {
  it('keeps the catalog order and drops empty entries', () => {
    const a = { id: 1 } as Media
    const b = { id: 2 } as Media
    expect(recommendedTitles({ recommendations: { nodes: [{ mediaRecommendation: a }, { mediaRecommendation: null }, { rating: 3, mediaRecommendation: b }] } })).toEqual([a, b])
    expect(recommendedTitles({})).toEqual([])
  })
})
