import { describe, expect, it } from 'vitest'
import {
  decodeStremioIdentity,
  encodeStremioIdentity,
  mapStremioMeta,
  stremioCatalogVariants,
  stremioHomeRowOptionsForSources,
  stremioCatalogUrl,
  stremioMetaMatchesIdentity,
  stremioMetaUrl,
  supportsStremioCatalogManifest,
} from './stremio'

describe('Stremio catalog identity', () => {
  it('round-trips add-on, type and native id without embedding a URL', () => {
    const encoded = encodeStremioIdentity('addon-fingerprint', 'series', 'tt123:1:2')
    expect(decodeStremioIdentity(encoded)).toEqual({
      addonId: 'addon-fingerprint', type: 'series', id: 'tt123:1:2',
    })
    expect(encoded).not.toContain('http')
  })

  it('rejects malformed identities', () => {
    expect(decodeStremioIdentity('not-json')).toBeNull()
    expect(decodeStremioIdentity(encodeURIComponent(JSON.stringify(['only', 'two'])))).toBeNull()
    expect(decodeStremioIdentity(encodeURIComponent(JSON.stringify(['a', 'movie', 'id', { year: '2011' }])))).toBeNull()
  })

  it('accepts the requested item but rejects a sibling returned for the same detail route', () => {
    const identity = {
      addonId: 'addon', type: 'movie', id: 'tt1798188',
      expectedTitle: 'From Up on Poppy Hill', expectedYear: 2011,
    }

    expect(stremioMetaMatchesIdentity({
      id: 'tt1798188', name: 'From Up on Poppy Hill (2011)', releaseInfo: '2011',
    }, identity)).toBe(true)
    expect(stremioMetaMatchesIdentity({
      id: 'tt1798188', name: 'Castle in the Sky', releaseInfo: '1986',
    }, identity)).toBe(false)
    expect(stremioMetaMatchesIdentity({
      id: 'tt0092067', name: 'From Up on Poppy Hill', releaseInfo: '2011',
    }, identity)).toBe(false)
  })

  it('builds protocol catalog and meta routes with encoded native values', () => {
    expect(stremioCatalogUrl('https://addon.test/manifest.json', { type: 'tv', id: 'top picks' }, { search: 'one & two', skip: 100 }))
      .toBe('https://addon.test/catalog/tv/top%20picks/search=one%20%26%20two&skip=100.json')
    expect(stremioMetaUrl('https://addon.test', 'series', 'tt123:1:2'))
      .toBe('https://addon.test/meta/series/tt123%3A1%3A2.json')
  })

  it('offers both an unfiltered catalog and every optional manifest filter', () => {
    const variants = stremioCatalogVariants({
      type: 'movie', id: 'top', name: 'Popular',
      extra: [{ name: 'genre', options: ['Action', 'Comedy'] }, { name: 'search' }],
    })
    expect(variants.map(({ title, extra, defaultEnabled }) => ({ title, extra, defaultEnabled }))).toEqual([
      { title: 'Popular Movies', extra: {}, defaultEnabled: true },
      { title: 'Popular Movies · Action', extra: { genre: 'Action' }, defaultEnabled: false },
      { title: 'Popular Movies · Comedy', extra: { genre: 'Comedy' }, defaultEnabled: false },
    ])
  })

  it('materializes required year catalogs but skips required history inputs it cannot invent', () => {
    expect(stremioCatalogVariants({
      type: 'series', id: 'year', name: 'New',
      extra: [{ name: 'genre', isRequired: true, options: ['2026', '2025'] }],
    }).map((variant) => [variant.title, variant.extra, variant.defaultEnabled])).toEqual([
      ['New TV · 2026', { genre: '2026' }, false],
      ['New TV · 2025', { genre: '2025' }, false],
    ])
    expect(stremioCatalogVariants({
      type: 'series', id: 'last-videos', name: 'Last videos',
      extra: [{ name: 'lastVideosIds', isRequired: true }],
    })).toEqual([])
  })

  it('retains the full artwork and descriptive metadata supplied by Cinemeta-style records', () => {
    const media = mapStremioMeta({
      id: 'tt1234567', type: 'movie', name: 'Example', poster: 'https://img.test/poster.jpg',
      background: 'https://img.test/backdrop.jpg', logo: 'https://img.test/logo.png',
      awards: '7 wins & 15 nominations', country: 'United Kingdom', language: 'English',
      writer: ['Writer One'], released: '2026-05-15T00:00:00Z', genre: ['Drama'],
    }, 'https://addon.test')
    expect(media).toMatchObject({
      coverImage: { extraLarge: 'https://img.test/poster.jpg' },
      bannerImage: 'https://img.test/backdrop.jpg',
      logoImage: 'https://img.test/logo.png',
      awards: '7 wins & 15 nominations',
      countryOfOrigin: 'United Kingdom',
      originalLanguage: 'English',
      creators: ['Writer One'],
      releaseDate: '2026-05-15',
      genres: ['Drama'],
    })
  })

  it('accepts catalog-only manifests used by Trakt and MDBList', () => {
    expect(supportsStremioCatalogManifest({
      id: 'community.trakt-tv', name: 'Trakt TV', version: '1.0.0',
      resources: [{ name: 'meta', types: ['movie', 'series'] }],
      catalogs: [{ type: 'trakt', id: 'watchlist', name: 'Watchlist' }],
    })).toBe(true)
    expect(supportsStremioCatalogManifest({
      id: 'com.mdblist.lists', name: 'MDBList', version: '1.0.0', resources: ['catalog'],
      catalogs: [{ type: 'movie', id: 'my-list', name: 'My List' }],
    })).toBe(true)
    expect(supportsStremioCatalogManifest({
      id: 'streams-only', name: 'Streams', version: '1.0.0', resources: ['stream'], catalogs: [],
    })).toBe(false)
  })

  it('offers account-backed lists as opt-in Home elements', () => {
    const rows = stremioHomeRowOptionsForSources([{
      base: 'https://2ecbbd610840-trakt.baby-beamup.club/u/private',
      manifest: {
        id: 'community.trakt-tv', name: 'Trakt TV', version: '1.0.0',
        catalogs: [
          { type: 'movie', id: 'watchlist', name: 'Watchlist' },
          { type: 'series', id: 'recommendations', name: 'Recommendations' },
        ],
      },
    }])
    expect(rows[0].id).toBe('continue')
    expect(rows.slice(1).map((row) => ({ title: row.title, group: row.group, defaultEnabled: row.defaultEnabled }))).toEqual([
      { title: 'Watchlist Movies', group: 'Trakt lists · Movies', defaultEnabled: false },
      { title: 'Recommendations TV', group: 'Trakt lists · TV', defaultEnabled: false },
    ])
  })
})
