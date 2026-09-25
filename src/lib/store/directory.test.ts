import { describe, expect, it } from 'vitest'
import { directoryEntries, directoryEntry } from './directory'

const listing = (patch: Record<string, unknown> = {}) => ({
  uuid: 'u', slug: 's', stars: 42, categories: [], createdAt: '2026-01-02T00:00:00Z',
  manifestUrl: 'https://addon.example.test/manifest.json', configureUrl: 'https://addon.example.test/configure',
  manifest: { id: 'org.example.addon', name: 'Example Addon', version: '1.0.0', types: ['anime', 'movie', 'channel'], logo: 'logo.png' },
  ...patch,
}) as never

describe('directoryEntry', () => {
  it('maps a directory listing to an addon entry keyed by its manifest id', () => {
    expect(directoryEntry(listing())).toMatchObject({
      key: 'addon-directory:source:org.example.addon', storeId: 'addon-directory', sourceType: 'stremio-addon',
      content: ['anime', 'movie'], popularity: 42, description: 'Community Stremio addon',
      icon: 'https://addon.example.test/logo.png',
      install: { type: 'addon', manifestUrl: 'https://addon.example.test/manifest.json', manifestId: 'org.example.addon', configureUrl: 'https://addon.example.test/configure' },
    })
  })

  it('drops unusable listings and never reads content types from the object prototype', () => {
    expect(directoryEntry(listing({ manifest: { id: 'x', name: 5, version: '1' } }))).toBeNull()
    expect(directoryEntry(listing({ manifestUrl: 'ftp://x.test/manifest.json' }))).toBeNull()
    expect(directoryEntry(listing({ manifest: { id: 'x', name: 'X', version: '1', types: ['constructor', 'anime'] } }))?.content).toEqual(['anime'])
  })
})

describe('directoryEntries', () => {
  it('keeps one entry per addon, the most starred', () => {
    const entries = directoryEntries([
      listing({ uuid: 'a', stars: 3 }),
      listing({ uuid: 'b', stars: 9 }),
      listing({ uuid: 'c', manifest: { id: 'other.addon', name: 'Other', version: '1' } }),
    ])
    expect(entries.map((entry) => [entry.id, entry.popularity])).toEqual([['org.example.addon', 9], ['other.addon', 42]])
  })
})
