// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { createHash } from 'node:crypto'
import { get } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ loadStoreAndPin: vi.fn() }))
vi.mock('$lib/store/service', () => ({ loadStoreAndPin: mocks.loadStoreAndPin }))

import { installedElsewhere, installedPlugins, installPlugin, preparePlugin, preparePluginFromUrl, removePlugin } from './registry'
import { pluginNote, pluginOriginLabel, pluginSections, pluginUpdatable } from './sections'
import { loadPluginListings, type PluginListing } from '$lib/store/plugins'
import { BUILTIN_STORES, PLUGIN_STORE_URL, addStore, allStores, hiddenBuiltinStores, removeStore, setStoreEnabled, userStores, type StoreFeed } from '$lib/store/feeds'
import { installedRef } from '$lib/store/install'
import type { StoreEntry } from '$lib/store/types'

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
const CODE = 'export default { activate() {} }\n'
const manifest = (extra: Record<string, unknown> = {}) => JSON.stringify({
  app: 'izumi', kind: 'plugin', schemaVersion: 1, pluginApi: 1, id: 'example.plugin', name: 'Example', version: '1.0.0',
  author: 'Someone', description: 'Does a thing.', main: { path: 'main.js', sha256: sha(CODE) },
  permissions: { scopes: ['player.events'] }, settings: [], ...extra,
})
const official = BUILTIN_STORES.find((store) => store.id === 'izumi-plugins')!
const FOLDER = 'https://plugins.example.test/c0ffee/example/'

const entry = (id: string, storeId: string, extra: Partial<StoreEntry> = {}, text = manifest()): StoreEntry => ({
  key: `${storeId}:plugin:${id}`, storeId, kind: 'plugin', id, name: id, version: '1.0.0', author: 'Someone', description: 'Does a thing.',
  languages: [], content: [], nsfw: false, requiresDebrid: false,
  install: { type: 'plugin', url: `${FOLDER}plugin.json`, sha256: sha(text), bytes: Buffer.byteLength(text), pluginApi: 1 },
  ...extra,
})
const listing = (store: StoreFeed, item: StoreEntry): PluginListing =>
  ({ entry: item, install: item.install as PluginListing['install'], origin: store.url, storeName: store.name })
const loaded = (store: StoreFeed, entries: StoreEntry[]) => ({ store, trust: { state: 'unsigned' }, listing: { entries }, cached: false, fetchedAt: 1 })
const served = (files: Record<string, string>) => vi.fn(async (url: string) => {
  if (!(url in files)) throw new Error(`${url} answered 404.`)
  return files[url]
})
const pinOf = (store: StoreFeed, item: StoreEntry) => {
  const install = item.install as PluginListing['install']
  return { origin: store.url, sha256: install.sha256, bytes: install.bytes, id: item.id, version: item.version }
}

beforeEach(async () => {
  userStores.set([])
  hiddenBuiltinStores.set([])
  for (const plugin of get(installedPlugins)) await removePlugin(plugin.manifest.id)
  mocks.loadStoreAndPin.mockReset()
})

describe('plugin stores', () => {
  it('builds in the reviewed marketplace, which can be hidden but not removed or added again', () => {
    expect(official).toMatchObject({ url: PLUGIN_STORE_URL, name: 'izumi plugins', builtin: true })
    expect(() => addStore(PLUGIN_STORE_URL, 'Copy')).toThrow('built in')
    removeStore(official.id)
    expect(get(allStores).map((store) => store.id)).toContain(official.id)
    setStoreEnabled(official.id, false)
    expect(get(allStores).find((store) => store.id === official.id)?.enabled).toBe(false)
  })

  it('lists the plugins of every shown store, tied to the store, and forgets a removed store', async () => {
    const mine = addStore('https://stores.example.test/store.json', 'My plugins')
    mocks.loadStoreAndPin.mockImplementation(async (store: StoreFeed) =>
      loaded(store, store.id === official.id ? [entry('official.one', store.id)] : store.id === mine.id ? [entry('mine.one', store.id)] : []))
    const listed = (await loadPluginListings()).listings
    expect(listed.map((item) => [item.entry.id, item.origin, item.storeName])).toEqual([
      ['official.one', PLUGIN_STORE_URL, 'izumi plugins'],
      ['mine.one', mine.url, 'My plugins'],
    ])
    expect(pluginSections([], listed).map((section) => [section.id, section.title])).toEqual([
      [`store-${official.id}`, 'izumi plugins'],
      [`store-${mine.id}`, 'My plugins'],
    ])

    removeStore(mine.id)
    expect((await loadPluginListings()).listings.map((item) => item.entry.id)).toEqual(['official.one'])
    setStoreEnabled(official.id, false)
    expect((await loadPluginListings()).listings).toEqual([])
  })

  it('hides plugins of a store that failed its signing-key check', async () => {
    mocks.loadStoreAndPin.mockImplementation(async (store: StoreFeed) => store.id === official.id
      ? { ...loaded(store, [entry('evil.one', store.id)]), trust: { state: 'locked', reason: 'key-changed' } }
      : loaded(store, []))
    const result = await loadPluginListings()
    expect(result.listings).toEqual([])
    expect(result.errors.some((error) => error.includes('its plugins are hidden'))).toBe(true)
  })
})

describe('installing from a store', () => {
  it('checks plugin.json against the listing and its code against plugin.json, and records the store', async () => {
    const item = entry('example.plugin', official.id)
    const fetchText = served({ [`${FOLDER}plugin.json`]: manifest(), [`${FOLDER}main.js`]: CODE })
    const prepared = await preparePluginFromUrl(`${FOLDER}plugin.json`, fetchText, pinOf(official, item))
    expect(prepared.origin).toBe(PLUGIN_STORE_URL)
    const installed = await installPlugin(prepared)
    expect(installed).toMatchObject({ origin: PLUGIN_STORE_URL, enabled: true })
    const plugins = get(installedPlugins).map((plugin) => ({ id: plugin.manifest.id, origin: plugin.origin }))
    const state = { addonBases: [], addonBaseById: {}, extensionSpecs: [], packages: [], packageOrigins: {}, legacyStores: [], themes: [], plugins }
    expect(installedRef(item, state, PLUGIN_STORE_URL)).toBe('example.plugin')
    expect(installedRef(item, state, 'https://stores.example.test/store.json')).toBeNull()
    expect(pluginOriginLabel(installed.origin, get(allStores))).toBe('izumi plugins')
  })

  it('refuses a plugin.json the listing does not pin, or one that is another plugin', async () => {
    const item = entry('example.plugin', official.id)
    const swapped = served({ [`${FOLDER}plugin.json`]: manifest({ version: '1.0.1' }), [`${FOLDER}main.js`]: CODE })
    await expect(preparePluginFromUrl(`${FOLDER}plugin.json`, swapped, pinOf(official, item))).rejects.toThrow('does not match its store listing')

    const other = manifest({ id: 'other.plugin' })
    const renamed = entry('example.plugin', official.id, {}, other)
    const fetchText = served({ [`${FOLDER}plugin.json`]: other, [`${FOLDER}main.js`]: CODE })
    await expect(preparePluginFromUrl(`${FOLDER}plugin.json`, fetchText, pinOf(official, renamed))).rejects.toThrow('not the example.plugin')

    const tampered = served({ [`${FOLDER}plugin.json`]: manifest(), [`${FOLDER}main.js`]: `${CODE}// more` })
    await expect(preparePluginFromUrl(`${FOLDER}plugin.json`, tampered, pinOf(official, item))).rejects.toThrow('does not match the hash')
  })

  it('never lets one source replace a plugin installed from another', async () => {
    const fromFile = await preparePlugin(manifest(), CODE, 'file')
    await installPlugin(fromFile)
    const fromStore = await preparePlugin(manifest(), CODE, PLUGIN_STORE_URL)
    expect(installedElsewhere(fromStore)?.origin).toBe('file')
    await expect(installPlugin(fromStore)).rejects.toThrow('already installed from somewhere else')
    await removePlugin('example.plugin')
    expect((await installPlugin(fromStore)).origin).toBe(PLUGIN_STORE_URL)
  })
})

describe('plugin gallery', () => {
  it('shows installs under Installed only, with updates and plugins this izumi cannot run', async () => {
    const mine = addStore('https://stores.example.test/store.json', 'My plugins')
    await installPlugin(await preparePlugin(manifest(), CODE, PLUGIN_STORE_URL))
    const listings = [
      listing(official, entry('example.plugin', official.id, { version: '1.1.0' })),
      listing(official, entry('future.plugin', official.id, { install: { ...entry('x', 'x').install, pluginApi: 3 } as StoreEntry['install'] })),
      // Another store's copy of an installed id is still listed there: installing it would be refused.
      listing(mine, entry('example.plugin', mine.id)),
    ]
    const sections = pluginSections(get(installedPlugins), listings)
    expect(sections.map((section) => [section.title, section.entries.map((item) => item.key)])).toEqual([
      ['Installed', [`${PLUGIN_STORE_URL}|example.plugin`]],
      ['izumi plugins', [`${PLUGIN_STORE_URL}|future.plugin`]],
      ['My plugins', [`${mine.url}|example.plugin`]],
    ])
    expect(pluginUpdatable(sections[0].entries[0])).toBe(true)
    expect(pluginNote(sections[1].entries[0])).toBe('Needs a newer izumi')
    expect(pluginSections(get(installedPlugins), listings, 'future').map((section) => section.title)).toEqual(['izumi plugins'])
    expect(pluginOriginLabel('file', get(allStores))).toBe('A file on this device')
    expect(pluginOriginLabel('https://raw.githubusercontent.com/someone/plugins/main/x/plugin.json', get(allStores))).toBe('someone/plugins')
  })
})
