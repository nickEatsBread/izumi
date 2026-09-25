// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import {
  BUILTIN_STORES, addStore, allStores, builtinStorePins, directoryEnabled, enabledStores, hiddenBuiltinStores,
  normalizeStoreFeeds, pinStoreKey, registerCatalogStore, removeStore, setStoreEnabled, storeIdForUrl, userStores,
} from './feeds'
import { ADDON_DIRECTORY_ID } from './types'

const KEY = 'c'.repeat(64)

beforeEach(() => {
  userStores.set([])
  hiddenBuiltinStores.set([])
  builtinStorePins.set({})
})

describe('store registry', () => {
  it('derives stable ids from URLs', () => {
    expect(storeIdForUrl('https://x.test/index.json')).toBe(storeIdForUrl('https://x.test/index.json'))
    expect(storeIdForUrl('https://x.test/index.json')).not.toBe(storeIdForUrl('https://y.test/index.json'))
    expect(storeIdForUrl('https://x.test/index.json')).toMatch(/^u-[a-z0-9]+$/)
  })

  it('lists built-in stores first and user stores after them', () => {
    addStore('https://stores.example.test/index.json', 'Example')
    expect(get(allStores).map((store) => store.name)).toEqual([...BUILTIN_STORES.map((store) => store.name), 'Example'])
  })

  it('refuses insecure links and copies of built-in stores', () => {
    expect(() => addStore('http://stores.example.test/index.json', 'Plain')).toThrow('HTTPS')
    expect(() => addStore(BUILTIN_STORES[0].url, 'Copy')).toThrow('HTTPS')
  })

  it('hides built-in stores instead of deleting them, and disables user stores in place', () => {
    const feed = addStore('https://stores.example.test/index.json', 'Example')
    setStoreEnabled(BUILTIN_STORES[0].id, false)
    setStoreEnabled(feed.id, false)
    setStoreEnabled(ADDON_DIRECTORY_ID, false)
    expect(get(enabledStores).map((store) => store.id)).toEqual([BUILTIN_STORES[1].id])
    expect(get(allStores)).toHaveLength(BUILTIN_STORES.length + 1)
    expect(get(directoryEnabled)).toBe(false)
    removeStore(feed.id)
    expect(get(userStores)).toEqual([])
  })

  it('pins and clears key fingerprints for user and built-in stores', () => {
    const feed = addStore('https://stores.example.test/index.json', 'Example')
    pinStoreKey(feed.id, KEY)
    pinStoreKey(BUILTIN_STORES[0].id, KEY)
    expect(get(allStores).filter((store) => store.pinnedKey === KEY)).toHaveLength(2)
    pinStoreKey(feed.id, undefined)
    expect(get(userStores)[0].pinnedKey).toBeUndefined()
    expect(() => pinStoreKey(feed.id, 'nope')).toThrow('fingerprint')
  })

  it('registers a pasted package catalog once, and never a built-in or shorthand one', () => {
    expect(registerCatalogStore('https://catalog.example.test/index.json')).toBe(true)
    expect(registerCatalogStore('https://catalog.example.test/index.json')).toBe(false)
    expect(registerCatalogStore(BUILTIN_STORES[0].url)).toBe(false)
    expect(registerCatalogStore('gh:someone/catalog')).toBe(false)
    expect(get(userStores).map((store) => store.name)).toEqual(['catalog.example.test'])
  })

  it('drops damaged saved entries', () => {
    expect(normalizeStoreFeeds([null, { url: 'ftp://x.test' }, { url: 'https://ok.test/i.json', name: ' OK ', pinnedKey: 'bad' }]))
      .toEqual([{ id: storeIdForUrl('https://ok.test/i.json'), url: 'https://ok.test/i.json', name: 'OK', enabled: true, addedAt: 0 }])
  })

  it('syncs the store list with the other device settings', () => {
    const manual = readFileSync(fileURLToPath(new URL('../sync/manual.ts', import.meta.url)), 'utf8')
    expect(manual).toContain('"store-feeds-v1",')
    expect(manual).toContain('"store-hidden-builtins-v1",')
  })
})
