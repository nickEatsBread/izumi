// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ loadStoreAndPin: vi.fn() }))
vi.mock('./service', () => ({ loadStoreAndPin: mocks.loadStoreAndPin }))

import { findStoreThemeRelease, loadThemeListings, themeStoreFor } from './themes'
import { BUILTIN_STORES, addStore, hiddenBuiltinStores, userStores, type StoreFeed } from './feeds'
import type { StoreEntry } from './types'

const themeEntry = (id: string): StoreEntry => ({
  key: `s:theme:${id}`, storeId: 's', kind: 'theme', id, name: id, languages: [], content: [], nsfw: false, requiresDebrid: false,
  install: { type: 'theme', release: { id, name: id, version: '1.0.0', author: 'A', description: '', themeApi: 2, tags: [], download: `https://x.test/${id}.json`, sha256: 'a'.repeat(64), bytes: 1 } },
})
const themesStore = BUILTIN_STORES[1]

beforeEach(() => {
  userStores.set([])
  hiddenBuiltinStores.set([])
  mocks.loadStoreAndPin.mockReset()
})

describe('store themes', () => {
  it('collects themes from every enabled store, with the store as origin, skipping locked stores', async () => {
    const other = addStore('https://other.test/index.json', 'Other')
    mocks.loadStoreAndPin.mockImplementation(async (store: StoreFeed) => {
      if (store.id === themesStore.id) return { store, trust: { state: 'unsigned' }, listing: { entries: [themeEntry('one')] }, cached: false, fetchedAt: 1 }
      if (store.id === other.id) return { store, trust: { state: 'locked', reason: 'key-changed' }, listing: { entries: [themeEntry('evil')] }, cached: false, fetchedAt: 1 }
      return { store, trust: { state: 'unsigned' }, listing: { entries: [] }, cached: false, fetchedAt: 1 }
    })
    const result = await loadThemeListings()
    expect(result.listings.map((listing) => [listing.release.id, listing.origin, listing.storeName]))
      .toEqual([['one', themesStore.url, themesStore.name]])
    expect(result.cached).toBe(false)
  })

  it('reports saved copies used after a failed refresh', async () => {
    mocks.loadStoreAndPin.mockImplementation(async (store: StoreFeed) =>
      ({ store, trust: { state: 'unsigned' }, listing: { entries: [] }, cached: true, fetchedAt: 1, error: 'offline' }))
    const result = await loadThemeListings()
    expect(result.cached).toBe(true)
    expect(result.errors[0]).toContain('offline')
  })

  it('finds a theme release in the store it was installed from', async () => {
    mocks.loadStoreAndPin.mockResolvedValue({ store: themesStore, trust: { state: 'unsigned' }, listing: { entries: [themeEntry('one')] }, cached: false, fetchedAt: 1 })
    expect((await findStoreThemeRelease(themesStore.url, 'one'))?.id).toBe('one')
    expect(await findStoreThemeRelease('https://unknown.test/x.json', 'one')).toBeUndefined()
    expect(themeStoreFor(themesStore.url)?.id).toBe('izumi-themes')
  })
})
