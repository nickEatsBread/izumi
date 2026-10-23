import { describe, expect, it } from 'vitest'
import { shelvesFor } from './store-shelves'
import type { ThemeListing } from '$lib/store/themes'

const OFFICIAL = 'https://official.test/index.json'
const listing = (id: string, tags: string[], origin = OFFICIAL, storeName = 'izumi themes'): ThemeListing => ({
  origin, storeName,
  release: { id, name: id, version: '1.0.0', author: 'a', description: '', themeApi: 5, tags, download: 'https://x.test/p.json', sha256: 'a'.repeat(64), bytes: 1 },
})

describe('theme store shelves', () => {
  it('groups the official catalog by tag, first match wins, then one shelf per other store', () => {
    const shelves = shelvesFor([
      listing('site', ['Dark', 'Site']), listing('phone', ['Phone', 'App']), listing('app', ['App']),
      listing('both', ['Site', 'Phone']), listing('classic', ['Dark']),
      listing('custom', ['Site'], 'https://mine.test/store.json', 'My store'),
    ], OFFICIAL)
    expect(shelves.map((shelf) => [shelf.title, shelf.listings.map((item) => item.release.id)])).toEqual([
      ['Look like the sites you know', ['site', 'both']],
      ['Made for phones', ['phone', 'app']],
      ['Classic themes', ['classic']],
      ['My store', ['custom']],
    ])
  })
  it('drops empty shelves', () => {
    expect(shelvesFor([listing('classic', [])], OFFICIAL).map((shelf) => shelf.id)).toEqual(['classic'])
  })
})
