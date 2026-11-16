import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME_KEY, shelvesFor, themeKey, themeSections } from './store-shelves'
import type { ThemeListing } from '$lib/store/themes'
import type { InstalledTheme } from './installed'

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
      ['Familiar layouts', ['site', 'both']],
      ['Made for phones', ['phone', 'app']],
      ['Classic themes', ['classic']],
      ['My store', ['custom']],
    ])
  })
  it('drops empty shelves', () => {
    expect(shelvesFor([listing('classic', [])], OFFICIAL).map((shelf) => shelf.id)).toEqual(['classic'])
  })
})

describe('theme list sections', () => {
  const install = (id: string, origin = OFFICIAL, name = id) => ({ id, origin, designId: id, package: { name, author: 'a', description: 'd' } }) as unknown as InstalledTheme
  it('puts the default and installs first, each install linked to its listing and shown only there', () => {
    const listings = [listing('frost', ['Site']), listing('iris', ['Site']), listing('coral', ['Phone'])]
    const sections = themeSections([install('frost'), install('mine', 'file:mine')], listings, OFFICIAL)
    expect(sections.map((section) => [section.id, section.entries.map((entry) => entry.key)])).toEqual([
      ['installed', [DEFAULT_THEME_KEY, themeKey(OFFICIAL, 'frost'), 'file:mine|mine']],
      ['sites', [themeKey(OFFICIAL, 'iris')]],
      ['phones', [themeKey(OFFICIAL, 'coral')]],
    ])
    expect(sections[0].entries[1].listing).toBe(listings[0])
  })
  it('drops a shelf whose every theme is installed', () => {
    expect(themeSections([install('frost')], [listing('frost', ['Site'])], OFFICIAL).map((section) => section.id)).toEqual(['installed'])
  })
  it('never links an install to a same-id listing from another store, which stays in its shelf', () => {
    const sections = themeSections([install('frost', 'https://other.test/store.json')], [listing('frost', ['Site'])], OFFICIAL)
    expect(sections[0].entries[1].listing).toBeUndefined()
    expect(sections[1].entries.map((entry) => entry.key)).toEqual([themeKey(OFFICIAL, 'frost')])
  })
  it('filters every section by the search and drops the ones left empty', () => {
    const sections = themeSections([install('frost', OFFICIAL, 'Frost')], [listing('coral', ['Phone'])], OFFICIAL, '  CORAL ')
    expect(sections.map((section) => section.id)).toEqual(['phones'])
  })
})
