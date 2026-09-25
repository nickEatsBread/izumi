import { describe, expect, it } from 'vitest'
import { adaptStoreDocument } from './adapters'

const HASH = 'b'.repeat(64)

describe('adaptStoreDocument', () => {
  it('reads a native store', () => {
    const listing = adaptStoreDocument({
      app: 'izumi', kind: 'store', schemaVersion: 1, id: 'com.example.store', name: 'Example',
      entries: [{ kind: 'source', sourceType: 'stream-provider', id: 'stream-one', name: 'Stream One', manifestUrl: 'https://x.test/one.json' }],
    }, 'https://x.test/index.json', 's')
    expect(listing).toMatchObject({ adapter: 'izumi-store', name: 'Example', skipped: 0 })
    expect(listing.entries).toHaveLength(1)
  })

  it('reads the theme catalog', () => {
    const listing = adaptStoreDocument({
      app: 'izumi', kind: 'theme-catalog', schemaVersion: 1,
      themes: [{ id: 'test.cinema', name: 'Cinema', version: '1.0.0', author: 'Test', description: 'Cinema look.', themeApi: 2, tags: ['dark'], download: 'https://x.test/cinema.json', sha256: HASH, bytes: 100 }],
    }, 'https://x.test/themes.json', 'themes')
    expect(listing.adapter).toBe('theme-catalog')
    expect(listing.entries[0]).toMatchObject({ key: 'themes:theme:test.cinema', kind: 'theme', install: { type: 'theme', release: { id: 'test.cinema', sha256: HASH } } })
  })

  it('reads an izumi package catalog', () => {
    const listing = adaptStoreDocument({
      formatVersion: 1, generatedAt: '2026-09-25T00:00:00Z', scope: { content: 'anime', transport: 'http', manga: false },
      packages: [{ id: 'example.pkg', name: 'Example', version: '2', nsfw: false, sources: [{ id: '1', name: 'Example Source' }], backend: 'izumi-js', package: 'https://x.test/p.izumi-ext', packageSha256: HASH, packageBytes: 10 }],
    }, 'https://x.test/index.json', 'pk')
    expect(listing.adapter).toBe('izumi-ext-catalog')
    expect(listing.entries[0]).toMatchObject({ sourceType: 'package', description: 'Example Source', content: ['anime'], install: { type: 'package' } })
  })

  it('reads an Aniyomi repository index', () => {
    const listing = adaptStoreDocument([
      { name: 'Aniyomi: Example', pkg: 'eu.kanade.tachiyomi.animeextension.en.example', apk: 'apk/example.apk', lang: 'en', code: 14, version: '14.2', nsfw: 0,
        sources: [{ id: '123', name: 'Example', lang: 'en', baseUrl: 'https://example.test' }] },
    ], 'https://repo.example.test/index.min.json', 'an')
    expect(listing.adapter).toBe('aniyomi-index')
    expect(listing.entries[0]).toMatchObject({
      id: 'eu.kanade.tachiyomi.animeextension.en.example', languages: ['en'],
      install: { type: 'package', pkg: { packageFormat: 'aniyomi-repo', apk: 'https://repo.example.test/apk/example.apk' } },
    })
  })

  it('lists marketplace providers one by one and skips kinds izumi cannot run', () => {
    const listing = adaptStoreDocument([
      { id: 'streamy', name: 'Streamy', type: 'onlinestream-provider', manifestURI: 'https://x.test/streamy.json', lang: 'fr' },
      { id: 'torrenty', name: 'Torrenty', type: 'anime-torrent-provider', manifestURI: 'https://x.test/torrenty.json' },
      { id: 'mangy', name: 'Mangy', type: 'manga-provider', manifestURI: 'https://x.test/mangy.json' },
      { id: 'plain', name: 'Plain', type: 'onlinestream-provider', manifestURI: 'http://x.test/plain.json' },
    ], 'https://x.test/marketplace.json', 'mk')
    expect(listing.adapter).toBe('marketplace')
    expect(listing.entries.map((entry) => [entry.id, entry.sourceType, entry.languages]))
      .toEqual([['streamy', 'stream-provider', ['fr']], ['torrenty', 'torrent-provider', []]])
    expect(listing.entries[0].install).toEqual({ type: 'extension', spec: 'https://x.test/streamy.json' })
    expect(listing.skipped).toBe(1)
  })

  it('tells the user when a link is a source rather than a store', () => {
    expect(() => adaptStoreDocument({ id: 'x', name: 'X', code: 'https://x.test/x.js' }, 'https://x.test/manifest.json', 's'))
      .toThrow('source, not a store')
    expect(() => adaptStoreDocument({ hello: 'world' }, 'https://x.test/x.json', 's')).toThrow('not a store izumi can open')
  })
})
