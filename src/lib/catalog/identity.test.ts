import { describe, expect, it } from 'vitest'
import type { Media } from '$lib/anilist/types'
import { anilistIdOf, catalogMediaHref, compatibilityMediaId, externalIdsOf, mediaKey } from './identity'

const title = { romaji: 'Example', userPreferred: 'Example' }

describe('provider-neutral media identity', () => {
  it('keeps provider-native ids out of AniList numeric id space', () => {
    const kitsu = { provider: 'kitsu' as const, type: 'anime' as const, id: '42' }
    const tmdb = { provider: 'tmdb' as const, type: 'movie' as const, id: '42' }
    expect(compatibilityMediaId(kitsu)).toBeLessThan(0)
    expect(compatibilityMediaId(kitsu)).toBe(compatibilityMediaId(kitsu))
    expect(compatibilityMediaId(kitsu)).not.toBe(compatibilityMediaId(tmdb))
  })

  it('only reports an AniList id when the provider or mappings establish one', () => {
    const media = {
      id: -42, catalog: { provider: 'kitsu', type: 'anime', id: '42' },
      externalIds: { kitsu: 42 }, type: 'ANIME', title,
    } as Media
    expect(anilistIdOf(media)).toBeUndefined()
    expect(externalIdsOf(media)).toEqual({ kitsu: 42 })
    expect(mediaKey(media)).toBe('kitsu:anime:42')
    expect(catalogMediaHref(media)).toBe('/app/media/kitsu/anime/42')

    media.externalIds = { kitsu: 42, anilist: 7 }
    expect(anilistIdOf(media)).toBe(7)
  })

  it('preserves legacy AniList media links and ids', () => {
    const media = { id: 7, type: 'ANIME', format: 'TV', title } as Media
    expect(anilistIdOf(media)).toBe(7)
    expect(mediaKey(media)).toBe('anilist:anime:7')
    expect(catalogMediaHref(media)).toBe('/app/anime/7')
  })
})
