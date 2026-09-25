// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import {
  BUILTIN_STORES, MAX_USER_STORES, addStore, allStores, directoryEnabled, enabledStores, hiddenBuiltinStores,
  normalizeHiddenBuiltins, normalizeStoreFeeds, normalizeStorePins, pinStoreKey, registerCatalogStore, removeStore,
  setStoreEnabled, storeIdForUrl, storePins, userStores,
} from './feeds'
import { ADDON_DIRECTORY_ID } from './types'

const KEY = 'c'.repeat(64)
const OTHER = 'd'.repeat(64)

beforeEach(() => {
  userStores.set([])
  hiddenBuiltinStores.set([])
  storePins.set({})
})

describe('store registry', () => {
  it('derives stable, fixed-width ids from URLs', () => {
    const id = storeIdForUrl('https://x.test/index.json')
    expect(id).toBe(storeIdForUrl('https://x.test/index.json'))
    expect(id).not.toBe(storeIdForUrl('https://y.test/index.json'))
    expect(id).toMatch(/^u-[a-z0-9]{14}$/)
    // These two URLs collide under a single 32-bit FNV-1a hash.
    expect(storeIdForUrl('https://stores.example.test/6ny8ydj1/index.json'))
      .not.toBe(storeIdForUrl('https://stores.example.test/97t69kgt/index.json'))
  })

  it('lists built-in stores first and user stores after them', () => {
    addStore('https://stores.example.test/index.json', 'Example')
    expect(get(allStores).map((store) => store.name)).toEqual([...BUILTIN_STORES.map((store) => store.name), 'Example'])
  })

  it('refuses insecure links, built-in copies, duplicates, bad pins and more than the cap', () => {
    expect(() => addStore('http://stores.example.test/index.json', 'Plain')).toThrow('HTTPS')
    expect(() => addStore(BUILTIN_STORES[0].url, 'Copy')).toThrow('built in')
    addStore('https://stores.example.test/index.json', 'Example')
    expect(() => addStore('https://stores.example.test/x/../index.json#again', 'Same')).toThrow('already added')
    expect(() => addStore('https://other.example.test/index.json', 'Bad pin', 'NOT-HEX')).toThrow('fingerprint')
    for (let index = 1; index < MAX_USER_STORES; index++) addStore(`https://s${index}.example.test/index.json`, `S${index}`)
    expect(() => addStore('https://one-too-many.example.test/index.json', 'Late')).toThrow(`up to ${MAX_USER_STORES}`)
  })

  it('never re-pins or re-enables an existing store by adding it again', () => {
    const feed = addStore('https://stores.example.test/index.json', 'Example', KEY)
    setStoreEnabled(feed.id, false)
    expect(() => addStore('https://stores.example.test/index.json', 'Example', OTHER)).toThrow('already added')
    expect(get(allStores).find((store) => store.id === feed.id)).toMatchObject({ enabled: false, pinnedKey: KEY })
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

  it("keeps pins on this device only, and clears a store's pin when it is removed", () => {
    const feed = addStore('https://stores.example.test/index.json', 'Example')
    pinStoreKey(feed.id, KEY)
    pinStoreKey(BUILTIN_STORES[0].id, KEY)
    expect(get(allStores).filter((store) => store.pinnedKey === KEY)).toHaveLength(2)
    expect(get(userStores)[0]).not.toHaveProperty('pinnedKey')
    pinStoreKey(feed.id, undefined)
    expect(get(allStores).find((store) => store.id === feed.id)?.pinnedKey).toBeUndefined()
    pinStoreKey(feed.id, KEY)
    removeStore(feed.id)
    expect(get(storePins)[feed.id]).toBeUndefined()
    expect(() => pinStoreKey(feed.id, 'nope')).toThrow('fingerprint')
  })

  it('cleans values that reach the stores without beforeRead (sync, restore)', () => {
    userStores.set([
      { id: 'izumi-packages', url: 'http://evil.test/index.json', name: 'Evil', enabled: true, addedAt: 0, builtin: true },
      { id: 'x', url: 'javascript:alert(1)', name: 'Script', enabled: true, addedAt: 0 },
      { id: 'y', url: 'https://ok.test/index.json', name: 'OK', enabled: true, addedAt: 0 },
      { id: 'z', url: 'https://ok.test/index.json#dupe', name: 'Dupe', enabled: true, addedAt: 0 },
    ] as never)
    hiddenBuiltinStores.set({} as never)
    storePins.set({ constructor: KEY, 'izumi-packages': 'not-hex' } as never)
    const users = get(allStores).filter((store) => !store.builtin)
    expect(users.map((store) => [store.url, store.name, store.builtin])).toEqual([['https://ok.test/index.json', 'OK', undefined]])
    expect(get(allStores).filter((store) => store.builtin).every((store) => store.enabled && !store.pinnedKey)).toBe(true)
    expect(get(directoryEnabled)).toBe(true)
  })

  it('registers a pasted package catalog once, and never a built-in, shorthand or credentialed one', () => {
    expect(registerCatalogStore('https://catalog.example.test/index.json')).toBe(true)
    expect(registerCatalogStore('https://catalog.example.test/index.json#copy')).toBe(false)
    expect(registerCatalogStore(BUILTIN_STORES[0].url)).toBe(false)
    expect(registerCatalogStore('gh:someone/catalog')).toBe(false)
    expect(registerCatalogStore('https://user:pass@catalog2.example.test/index.json')).toBe(false)
    expect(get(userStores).map((store) => store.name)).toEqual(['catalog.example.test'])
  })

  it('normalises saved lists, hidden ids and pins', () => {
    expect(normalizeStoreFeeds([null, { url: 'ftp://x.test' }, { url: 'https://ok.test/i.json', name: ' OK ', pinnedKey: KEY }]))
      .toEqual([{ id: storeIdForUrl('https://ok.test/i.json'), url: 'https://ok.test/i.json', name: 'OK', enabled: true, addedAt: 0 }])
    expect(normalizeHiddenBuiltins(['izumi-themes', 'unknown', 3, 'izumi-themes'])).toEqual(['izumi-themes'])
    expect(normalizeStorePins({ 'izumi-packages': KEY, junk: KEY, [storeIdForUrl('https://ok.test/i.json')]: 'x' }))
      .toEqual({ 'izumi-packages': KEY })
  })
})
