// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get, writable, type Writable } from 'svelte/store'

const mocks = vi.hoisted(() => ({
  extensionUrls: null as unknown as Writable<string[]>,
  disabledExtensions: null as unknown as Writable<string[]>,
}))
vi.mock('$lib/settings/ui', () => {
  mocks.extensionUrls = writable<string[]>([])
  mocks.disabledExtensions = writable<string[]>([])
  return { extensionUrls: mocks.extensionUrls, disabledExtensions: mocks.disabledExtensions }
})

import { examinedCatalogSpecs, migrateCatalogStores } from './migrate'
import { userStores } from './feeds'

beforeEach(() => {
  userStores.set([])
  examinedCatalogSpecs.set([])
  mocks.disabledExtensions.set([])
})

describe('migrateCatalogStores', () => {
  it('registers package catalogs as stores once, leaves manifests alone, and retries unreachable ones', async () => {
    mocks.extensionUrls.set(['https://catalog.test/index.json', 'https://manifest.test/m.json', 'https://down.test/index.json'])
    const fetchInfo = vi.fn(async (spec: string) => spec.includes('catalog')
      ? { packages: [] }
      : spec.includes('down')
        ? { problem: 'That URL could not be fetched.' }
        : { problem: 'No runnable extensions were found in this source.' })
    expect(await migrateCatalogStores(fetchInfo)).toBe(1)
    expect(get(userStores).map((store) => store.url)).toEqual(['https://catalog.test/index.json'])
    expect(get(examinedCatalogSpecs)).toEqual(['https://catalog.test/index.json', 'https://manifest.test/m.json'])
    fetchInfo.mockClear()
    await migrateCatalogStores(fetchInfo)
    expect(fetchInfo.mock.calls.map(([spec]) => spec)).toEqual(['https://down.test/index.json'])
  })

  it('keeps a catalog switched off on the Sources page switched off as a store', async () => {
    mocks.extensionUrls.set(['https://off.test/index.json'])
    mocks.disabledExtensions.set(['https://off.test/index.json'])
    await migrateCatalogStores(vi.fn(async () => ({ packages: [] })))
    expect(get(userStores).map((store) => [store.url, store.enabled])).toEqual([['https://off.test/index.json', false]])
  })

  it('gives up on a catalog that answers 4xx, and retries server errors', async () => {
    mocks.extensionUrls.set(['https://gone.test/index.json', 'https://busy.test/index.json'])
    const fetchInfo = vi.fn(async (spec: string) => ({ problem: spec.includes('gone') ? 'That URL returned HTTP 404.' : 'That URL returned HTTP 503.' }))
    await migrateCatalogStores(fetchInfo)
    expect(get(examinedCatalogSpecs)).toEqual(['https://gone.test/index.json'])
  })

  it('drops the old theme catalog copy from localStorage', async () => {
    // Isolated from whatever a previous test left `extensionUrls` as: this test verifies the
    // localStorage cleanup only, so `info` (here, a bare vi.fn()) must never actually be invoked.
    mocks.extensionUrls.set([])
    localStorage.setItem('theme-catalog-cache-v1', '{}')
    await migrateCatalogStores(vi.fn())
    expect(localStorage.getItem('theme-catalog-cache-v1')).toBeNull()
  })

  it('shares one run between overlapping calls, so nothing is examined twice', async () => {
    mocks.extensionUrls.set(['https://catalog.test/index.json'])
    const fetchInfo = vi.fn(async () => ({ packages: [] }))
    expect(await Promise.all([migrateCatalogStores(fetchInfo), migrateCatalogStores(fetchInfo)])).toEqual([1, 1])
    expect(fetchInfo).toHaveBeenCalledTimes(1)
    expect(get(examinedCatalogSpecs)).toEqual(['https://catalog.test/index.json'])
  })
})
