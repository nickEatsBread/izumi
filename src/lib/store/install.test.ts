import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get, writable, type Writable } from 'svelte/store'

const mocks = vi.hoisted(() => ({
  currentLegacyStores: vi.fn(),
  stores: {} as Record<string, Writable<string[]>>,
}))
vi.mock('$lib/stremio/sources', () => {
  mocks.stores.addonUrls = writable<string[]>([])
  mocks.stores.disabledSources = writable<string[]>([])
  return { addonUrls: mocks.stores.addonUrls, disabledSources: mocks.stores.disabledSources }
})
vi.mock('$lib/settings/ui', () => {
  mocks.stores.extensionUrls = writable<string[]>([])
  mocks.stores.disabledExtensions = writable<string[]>([])
  mocks.stores.disabledPlugins = writable<string[]>([])
  return {
    extensionUrls: mocks.stores.extensionUrls,
    disabledExtensions: mocks.stores.disabledExtensions,
    disabledPlugins: mocks.stores.disabledPlugins,
  }
})
vi.mock('./origins', () => ({ currentLegacyStores: mocks.currentLegacyStores }))

import { installStoreEntry, installedRef, type InstalledState } from './install'
import type { StoreEntry } from './types'

const base = { storeId: 's', languages: [], content: [], nsfw: false, requiresDebrid: false }
const addon = (configureUrl?: string, manifestId?: string): StoreEntry => ({
  ...base, key: 's:source:addon', kind: 'source', sourceType: 'stremio-addon', id: 'example-addon', name: 'Example Addon',
  install: { type: 'addon', manifestUrl: 'https://addon.example.test/manifest.json', ...(configureUrl ? { configureUrl } : {}), ...(manifestId ? { manifestId } : {}) },
})
const pkg = { packageFormat: 'izumi-ext' as const, id: 'example.pkg', name: 'Example Package', version: '1', nsfw: false, sources: [], backend: 'izumi-js' as const, package: 'https://x.test/p.izumi-ext', packageSha256: 'a'.repeat(64), packageBytes: 1 }
const packageEntry: StoreEntry = { ...base, key: 's:source:pkg', kind: 'source', sourceType: 'package', id: 'example.pkg', name: 'Example Package', install: { type: 'package', pkg } }
const streamEntry: StoreEntry = { ...base, key: 's:source:stream', kind: 'source', sourceType: 'stream-provider', id: 'stream', name: 'Stream', install: { type: 'extension', spec: 'https://x.test/stream.json' } }
const themeEntry: StoreEntry = {
  ...base, key: 's:theme:test.cinema', kind: 'theme', id: 'test.cinema', name: 'Cinema',
  install: { type: 'theme', release: { id: 'test.cinema', name: 'Cinema', version: '1.0.0', author: 'T', description: '', themeApi: 2, tags: [], download: 'https://x.test/t.json', sha256: 'a'.repeat(64), bytes: 1 } },
}

beforeEach(() => {
  for (const store of Object.values(mocks.stores)) store.set([])
  mocks.currentLegacyStores.mockReset().mockReturnValue([])
})

describe('installStoreEntry', () => {
  it('adds and enables a plain addon by its base URL', async () => {
    mocks.stores.disabledSources.set(['https://addon.example.test'])
    expect(await installStoreEntry(addon(), { storeUrl: '' }, vi.fn())).toEqual({ kind: 'installed', message: 'Example Addon installed and enabled.' })
    expect(get(mocks.stores.addonUrls)).toEqual(['https://addon.example.test'])
    expect(get(mocks.stores.disabledSources)).toEqual([])
  })

  it("hands a configurable addon to the configurator, checked against the addon's manifest id", async () => {
    expect(await installStoreEntry(addon('https://addon.example.test/configure', 'org.example.addon'), { storeUrl: '' }, vi.fn()))
      .toEqual({ kind: 'configure', name: 'Example Addon', id: 'org.example.addon', configureUrl: 'https://addon.example.test/configure' })
    expect(get(mocks.stores.addonUrls)).toEqual([])
  })

  it('adds a streaming source once and re-enables it', async () => {
    mocks.stores.disabledExtensions.set(['https://x.test/stream.json'])
    await installStoreEntry(streamEntry, { storeUrl: 'https://x.test/index.json' }, vi.fn())
    await installStoreEntry(streamEntry, { storeUrl: 'https://x.test/index.json' }, vi.fn())
    expect(get(mocks.stores.extensionUrls)).toEqual(['https://x.test/stream.json'])
    expect(get(mocks.stores.disabledExtensions)).toEqual([])
  })

  it('installs a package bound to its store, and lists classic catalogs as sources without re-enabling them', async () => {
    mocks.stores.disabledPlugins.set(['example.pkg'])
    mocks.stores.disabledExtensions.set(['https://x.test/index.json'])
    let sourcesWhenFrozen: string[] | undefined
    mocks.currentLegacyStores.mockImplementation(() => {
      sourcesWhenFrozen = get(mocks.stores.extensionUrls)
      return []
    })
    const installPackage = vi.fn().mockResolvedValue({ id: 'example.pkg', name: 'Example Package' })
    await installStoreEntry(packageEntry, { storeUrl: 'https://x.test/index.json', adapter: 'izumi-ext-catalog' }, installPackage)
    expect(installPackage).toHaveBeenCalledWith(pkg, 'https://x.test/index.json')
    // The legacy stores were frozen before this catalog joined the source list.
    expect(sourcesWhenFrozen).toEqual([])
    expect(get(mocks.stores.extensionUrls)).toEqual(['https://x.test/index.json'])
    expect(get(mocks.stores.disabledExtensions)).toEqual(['https://x.test/index.json'])
    expect(get(mocks.stores.disabledPlugins)).toEqual([])
  })

  it('keeps native stores out of the source list when installing their packages', async () => {
    await installStoreEntry(packageEntry, { storeUrl: 'https://x.test/store.json', adapter: 'izumi-store' },
      vi.fn().mockResolvedValue({ id: 'example.pkg', name: 'Example Package' }))
    expect(get(mocks.stores.extensionUrls)).toEqual([])
  })

  it('changes nothing when the installer refuses a takeover', async () => {
    mocks.stores.disabledPlugins.set(['example.pkg'])
    const installPackage = vi.fn().mockRejectedValue(new Error('This package is installed from another store. Remove it there first.'))
    await expect(installStoreEntry(packageEntry, { storeUrl: 'https://x.test/index.json', adapter: 'izumi-ext-catalog' }, installPackage))
      .rejects.toThrow('another store')
    expect(get(mocks.stores.extensionUrls)).toEqual([])
    expect(get(mocks.stores.disabledPlugins)).toEqual(['example.pkg'])
  })

  it('refuses a package with no store to bind it to', async () => {
    const installPackage = vi.fn()
    await expect(installStoreEntry(packageEntry, { storeUrl: '' }, installPackage)).rejects.toThrow('no store')
    expect(installPackage).not.toHaveBeenCalled()
  })

  it('sends themes to the Themes page for preview', async () => {
    expect(await installStoreEntry(themeEntry, { storeUrl: 'https://x.test/themes.json' }, vi.fn()))
      .toEqual({ kind: 'open-theme', path: '/app/settings/themes?store=s&theme=test.cinema' })
  })
})

describe('installedRef', () => {
  const state: InstalledState = {
    addonBases: ['https://addon.example.test'],
    addonBaseById: {},
    extensionSpecs: ['https://x.test/index.json'],
    packages: [{ id: 'example.pkg' }],
    packageOrigins: {},
    legacyStores: ['https://x.test/index.json'],
    themes: [{ id: 'test.cinema', origin: 'https://x.test/themes.json' }],
  }

  it('recognises installed entries of every kind', () => {
    expect(installedRef(addon(), state, '')).toBe('https://addon.example.test')
    expect(installedRef(addon(undefined, 'org.example.addon'), { ...state, addonBases: [], addonBaseById: { 'org.example.addon': 'https://addon.example.test/key' } }, ''))
      .toBe('https://addon.example.test/key')
    expect(installedRef(streamEntry, state, 'https://x.test/index.json')).toBe('https://x.test/index.json')
    expect(installedRef(streamEntry, state, 'https://other.test/index.json')).toBeNull()
    expect(installedRef(themeEntry, state, 'https://x.test/themes.json')).toBe('test.cinema')
    expect(installedRef(themeEntry, state, 'https://other.test/themes.json')).toBeNull()
  })

  it('matches an installed addon by manifest id only when every host the listing names is its host', () => {
    const configured = { ...state, addonBases: [], addonBaseById: { 'org.example.addon': 'https://addon.example.test/key' } }
    const impostor: StoreEntry = {
      ...addon(), install: { type: 'addon', manifestUrl: 'https://impostor.test/manifest.json', manifestId: 'org.example.addon' },
    }
    expect(installedRef(impostor, configured, '')).toBeNull()
    // A foreign configure page must not inherit the installed copy either (Reconfigure would replace it).
    const foreignConfigure: StoreEntry = {
      ...addon(),
      install: { type: 'addon', manifestUrl: 'https://addon.example.test/manifest.json', manifestId: 'org.example.addon', configureUrl: 'https://impostor.test/configure' },
    }
    expect(installedRef(foreignConfigure, configured, '')).toBeNull()
    const sameHost: StoreEntry = {
      ...addon(),
      install: { type: 'addon', manifestUrl: 'https://addon.example.test/manifest.json', manifestId: 'org.example.addon', configureUrl: 'https://addon.example.test/configure' },
    }
    expect(installedRef(sameHost, configured, '')).toBe('https://addon.example.test/key')
  })

  it('binds installed packages to the store they came from', () => {
    expect(installedRef(packageEntry, state, 'https://x.test/index.json')).toBe('example.pkg')
    expect(installedRef(packageEntry, state, 'https://stranger.test/index.json')).toBeNull()
    const withOrigin = { ...state, packageOrigins: { 'example.pkg': 'https://stranger.test/index.json' } }
    expect(installedRef(packageEntry, withOrigin, 'https://stranger.test/index.json')).toBe('example.pkg')
    expect(installedRef(packageEntry, withOrigin, 'https://x.test/index.json')).toBeNull()
  })

  it('never resolves ids through the object prototype', () => {
    expect(installedRef(addon(undefined, 'constructor'), { ...state, addonBases: [] }, '')).toBeNull()
  })
})
