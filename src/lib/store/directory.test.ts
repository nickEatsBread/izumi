import { describe, expect, it } from 'vitest'
import { directoryEntry } from './directory'

describe('directoryEntry', () => {
  it('maps a directory listing to an addon entry keyed by its manifest id', () => {
    const entry = directoryEntry({
      uuid: 'u', slug: 's', stars: 42, categories: [], createdAt: '2026-01-02T00:00:00Z',
      manifestUrl: 'https://addon.example.test/manifest.json', configureUrl: 'https://addon.example.test/configure',
      manifest: { id: 'org.example.addon', name: 'Example Addon', version: '1.0.0', types: ['anime', 'movie', 'channel'], logo: 'logo.png' },
    })
    expect(entry).toMatchObject({
      key: 'addon-directory:source:org.example.addon', storeId: 'addon-directory', sourceType: 'stremio-addon',
      content: ['anime', 'movie'], popularity: 42, description: 'Community Stremio addon',
      icon: 'https://addon.example.test/logo.png',
      install: { type: 'addon', manifestUrl: 'https://addon.example.test/manifest.json', configureUrl: 'https://addon.example.test/configure' },
    })
  })
})
