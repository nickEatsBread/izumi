import { describe, expect, it } from 'vitest'
import { decodeJvmIdentity, encodeJvmIdentity, mapJvmCatalogMedia } from './jvm'

describe('JVM catalog mapping', () => {
  const source = { id: '12345', name: 'AniDB', icon: 'https://img.example/anidb.png' }

  it('keeps the source and native URL in a restart-safe opaque identity', () => {
    const encoded = encodeJvmIdentity({
      sourceId: source.id,
      url: '/anime/attack-on-titan',
      title: 'Attack on Titan',
      cover: 'https://img.example/cover.jpg',
    })
    expect(decodeJvmIdentity(encoded)).toEqual({
      sourceId: source.id,
      url: '/anime/attack-on-titan',
      title: 'Attack on Titan',
      cover: 'https://img.example/cover.jpg',
    })
    expect(decodeJvmIdentity('not-json')).toBeNull()
  })

  it('normalizes Android thumbnail fields and Aniyomi metadata', () => {
    const media = mapJvmCatalogMedia({
      title: 'Attack on Titan',
      url: '/anime/attack-on-titan',
      thumbnail_url: 'https://img.example/cover.jpg',
      background_url: 'https://img.example/banner.jpg',
      description: 'Humanity fights back.',
      genre: ['Action', 'Drama'],
      status: 2,
    }, source)
    expect(media).toMatchObject({
      type: 'ANIME',
      format: 'TV',
      status: 'FINISHED',
      genres: ['Action', 'Drama'],
      bannerImage: 'https://img.example/banner.jpg',
      coverImage: { extraLarge: 'https://img.example/cover.jpg' },
      catalog: {
        provider: 'jvm', type: 'anime', sourceName: 'AniDB', sourceIcon: 'https://img.example/anidb.png',
      },
    })
    expect(decodeJvmIdentity(media!.catalog!.id)?.sourceId).toBe(source.id)
  })

  it('rejects catalog entries that cannot be reopened for details', () => {
    expect(mapJvmCatalogMedia({ title: 'Missing URL' }, source)).toBeNull()
    expect(mapJvmCatalogMedia({ url: '/missing-title' }, source)).toBeNull()
  })
})
