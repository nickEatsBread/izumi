import { describe, expect, it } from 'vitest'
import { decodeStremioIdentity, encodeStremioIdentity, stremioCatalogUrl, stremioMetaUrl } from './stremio'

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
  })

  it('builds protocol catalog and meta routes with encoded native values', () => {
    expect(stremioCatalogUrl('https://addon.test/manifest.json', { type: 'tv', id: 'top picks' }, { search: 'one & two', skip: 100 }))
      .toBe('https://addon.test/catalog/tv/top%20picks/search=one%20%26%20two&skip=100.json')
    expect(stremioMetaUrl('https://addon.test', 'series', 'tt123:1:2'))
      .toBe('https://addon.test/meta/series/tt123%3A1%3A2.json')
  })
})
