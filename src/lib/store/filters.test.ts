import { describe, expect, it } from 'vitest'
import { DEFAULT_STORE_FILTER, entryTypeLabel, filterStoreEntries, storeLanguages } from './filters'
import type { StoreEntry } from './types'

const entry = (patch: Partial<StoreEntry> & Pick<StoreEntry, 'id'>): StoreEntry => ({
  key: `s:source:${patch.id}`, storeId: 's', kind: 'source', sourceType: 'stream-provider', name: patch.id,
  languages: [], content: [], nsfw: false, requiresDebrid: false,
  install: { type: 'extension', spec: `https://x.test/${patch.id}.json` },
  ...patch,
})

const entries = [
  entry({ id: 'bravo', storeId: 'a', languages: ['en'], content: ['anime'], popularity: 5, updatedAt: '2026-01-01' }),
  entry({ id: 'alpha', storeId: 'b', sourceType: 'stremio-addon', requiresDebrid: true, popularity: 9, updatedAt: '2025-01-01' }),
  entry({ id: 'adult', storeId: 'a', nsfw: true, languages: ['ja'] }),
  entry({ id: 'look', kind: 'theme', sourceType: undefined, description: 'A dark cinema look' }),
]
const run = (patch: Partial<typeof DEFAULT_STORE_FILTER>, installed: string[] = []) =>
  filterStoreEntries(entries, { ...DEFAULT_STORE_FILTER, ...patch }, (item) => installed.includes(item.id)).map((item) => item.id)

describe('filterStoreEntries', () => {
  it('hides 18+ entries unless the profile shows adult content', () => {
    expect(run({})).not.toContain('adult')
    expect(run({ showAdult: true })).toContain('adult')
  })
  it('filters by store, kind, source type, language, content, debrid and installed state', () => {
    expect(run({ storeIds: ['a'] })).toEqual(['bravo'])
    expect(run({ kind: 'theme' })).toEqual(['look'])
    expect(run({ sourceType: 'stremio-addon' })).toEqual(['alpha'])
    expect(run({ language: 'en' })).toEqual(['bravo'])
    expect(run({ content: 'anime' })).toEqual(['bravo'])
    expect(run({ withoutDebrid: true })).not.toContain('alpha')
    expect(run({ installedOnly: true }, ['look'])).toEqual(['look'])
  })
  it('searches names, ids, authors and descriptions', () => {
    expect(run({ query: 'CINEMA' })).toEqual(['look'])
  })
  it('sorts by popularity, recency or name', () => {
    expect(run({ sort: 'popular' })).toEqual(['alpha', 'bravo', 'look'])
    expect(run({ sort: 'updated' })).toEqual(['bravo', 'alpha', 'look'])
    expect(run({ sort: 'name' })).toEqual(['alpha', 'bravo', 'look'])
  })
})

describe('labels', () => {
  it('names every kind of entry', () => {
    expect(entryTypeLabel({ kind: 'source', sourceType: 'package' })).toBe('Package')
    expect(entryTypeLabel({ kind: 'source', sourceType: 'torrent-provider' })).toBe('Torrent source')
    expect(entryTypeLabel({ kind: 'theme' })).toBe('Theme')
  })
  it('lists the languages present, sorted', () => {
    expect(storeLanguages(entries)).toEqual(['en', 'ja'])
  })
})
