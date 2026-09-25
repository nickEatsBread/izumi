// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get, writable, type Writable } from 'svelte/store'

const mocks = vi.hoisted(() => ({ extensionUrls: null as unknown as Writable<string[]> }))
vi.mock('$lib/settings/ui', () => {
  mocks.extensionUrls = writable<string[]>([])
  return { extensionUrls: mocks.extensionUrls }
})

import { examinedCatalogSpecs, migrateCatalogStores } from './migrate'
import { userStores } from './feeds'

beforeEach(() => {
  userStores.set([])
  examinedCatalogSpecs.set([])
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
})
