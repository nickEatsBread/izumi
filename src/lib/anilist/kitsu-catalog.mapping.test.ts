import { describe, expect, it } from 'vitest'
import { mapKitsuMedia } from './kitsu-catalog'
import { mapKitsuRelations } from '$lib/catalog/providers/kitsu'

describe('native Kitsu media mapping', () => {
  const raw = {
    id: '42',
    attributes: {
      canonicalTitle: 'Example', titles: { en: 'Example' }, subtype: 'TV',
      status: 'current', startDate: '2026-01-02', episodeCount: 12, averageRating: '82.4',
    },
  }

  it('retains the Kitsu identity when no AniList mapping exists', () => {
    const media = mapKitsuMedia(raw)
    expect(media.id).toBeLessThan(0)
    expect(media.catalog).toEqual({ provider: 'kitsu', type: 'anime', id: '42' })
    expect(media.externalIds).toEqual({ kitsu: 42, anilist: undefined })
    expect(media.ratings).toEqual([{ source: 'Kitsu', score: 82.4, scale: 100 }])
  })

  it('keeps a supplied AniList mapping as an external id for compatibility fallback', () => {
    const media = mapKitsuMedia(raw, 7)
    expect(media.id).toBe(7)
    expect(media.externalIds).toEqual({ kitsu: 42, anilist: 7 })
  })

  it('maps Kitsu media relationships to provider-native related cards', () => {
    const relations = mapKitsuRelations([
      {
        id: '9', type: 'mediaRelationships', attributes: { role: 'sequel' },
        relationships: { destination: { data: { type: 'anime', id: '43' } } },
      },
      { id: '43', type: 'anime', attributes: { canonicalTitle: 'Example 2', subtype: 'TV' } },
    ] as never)
    expect(relations.edges[0]).toMatchObject({
      relationType: 'SEQUEL',
      node: { catalog: { provider: 'kitsu', type: 'anime', id: '43' } },
    })
  })
})
