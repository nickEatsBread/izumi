import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { mapMalAnimeListMedia } from '$lib/trackers/mal-list-media'
import { lacksTrailerField, MEDIA_TRAILER_QUERY } from './trailer'

describe('trailer lookup for cards built without one', () => {
  it('covers a MyAnimeList list card, which maps MAL data with no trailer', () => {
    const media = mapMalAnimeListMedia({ id: 101, title: 'Example title' }, 202)
    expect(media.trailer).toBeUndefined()
    expect(lacksTrailerField(media)).toBe(true)
  })

  it('leaves cards that already asked AniList, and catalog titles, alone', () => {
    expect(lacksTrailerField({ id: 21459, type: 'ANIME', trailer: { id: 'abc', site: 'youtube' } })).toBe(false)
    // AniList answered: this title has no trailer.
    expect(lacksTrailerField({ id: 21459, type: 'ANIME', trailer: null })).toBe(false)
    expect(lacksTrailerField({ id: -12, type: 'ANIME', trailer: undefined })).toBe(false)
    expect(lacksTrailerField({ id: 30, type: 'MANGA', trailer: undefined })).toBe(false)
    expect(lacksTrailerField({ id: 5, type: 'ANIME', trailer: undefined, catalog: { provider: 'tmdb', id: 'tv:5' } as never })).toBe(false)
  })

  it('asks for the trailer alone, keyed by the title so the cache shares it', () => {
    const query = MEDIA_TRAILER_QUERY.loc?.source.body ?? ''
    expect(query).toContain('Media(id: $id, type: ANIME)')
    expect(query.replace(/\s+/g, ' ')).toContain('{ id trailer { id site } }')
  })

  it('is what the hover preview falls back to', () => {
    const card = readFileSync(fileURLToPath(new URL('../components/cards/PreviewCard.svelte', import.meta.url)), 'utf8')
    expect(card).toContain('if (!lacksTrailerField(target)) return')
    expect(card).toContain('anilist.query(MEDIA_TRAILER_QUERY, { id: target.id })')
    expect(card).toContain('youtubeTrailerId(media.trailer ?? (looked?.id === media.id ? looked.trailer : undefined))')
  })
})
