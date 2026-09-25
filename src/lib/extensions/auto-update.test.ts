import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { get, writable, type Writable } from 'svelte/store'

// Background auto-update for installed .izumi-ext packages: compare installed versions against the
// live store listings, reinstall what changed, say so once. The listing is the canonical version — a
// rollback is applied the same way as an upgrade — and a package only updates from its own store.

const mocks = vi.hoisted(() => ({
  fetchExtensionInfo: vi.fn(),
  installedExtensionPackages: vi.fn(),
  installCatalogPackage: vi.fn(),
  loadStoreAndPin: vi.fn(),
  recordPackageOrigin: vi.fn(),
  extensionUrls: null as unknown as Writable<string[]>,
  enabledExtensionUrls: null as unknown as Writable<string[]>,
  allStores: null as unknown as Writable<unknown[]>,
  enabledStores: null as unknown as Writable<unknown[]>,
  packageOrigins: null as unknown as Writable<Record<string, string>>,
  playing: null as unknown as Writable<boolean>,
}))

vi.mock('./manager', () => ({
  fetchExtensionInfo: mocks.fetchExtensionInfo,
  installedExtensionPackages: mocks.installedExtensionPackages,
  installCatalogPackage: mocks.installCatalogPackage,
}))
vi.mock('$lib/settings/ui', () => {
  mocks.extensionUrls = writable<string[]>([])
  mocks.enabledExtensionUrls = writable<string[]>([])
  return { extensionUrls: mocks.extensionUrls, enabledExtensionUrls: mocks.enabledExtensionUrls }
})
vi.mock('$lib/store/feeds', () => {
  mocks.allStores = writable<unknown[]>([])
  mocks.enabledStores = writable<unknown[]>([])
  return { allStores: mocks.allStores, enabledStores: mocks.enabledStores }
})
vi.mock('$lib/store/service', () => ({ loadStoreAndPin: mocks.loadStoreAndPin }))
vi.mock('$lib/store/origins', () => {
  mocks.packageOrigins = writable<Record<string, string>>({})
  return { packageOrigins: mocks.packageOrigins, recordPackageOrigin: mocks.recordPackageOrigin }
})
vi.mock('$lib/player/session', () => {
  mocks.playing = writable(false)
  return { playing: mocks.playing }
})

import { collectPackageUpdates, checkExtensionUpdates, extensionUpdateNotice } from './auto-update'
import type { ExtensionCatalogPackage } from './catalog'
import type { InstalledExtensionPackage } from './manager'

const pkg = (id: string, version: string, name = id): ExtensionCatalogPackage => ({
  id, name, version, nsfw: false, sources: [], backend: 'izumi-js',
  package: `https://x/${id}-v${version}.izumi-ext`, packageSha256: 'aa', packageBytes: 1,
})
const inst = (id: string, version: string): InstalledExtensionPackage => ({
  id, name: id, version, backend: 'izumi-js', sourceId: id, sourceIds: [id], signed: true,
})
const store = (id: string, url: string) => ({ id, url, name: id, enabled: true, addedAt: 0 })
const loaded = (url: string, packages: ExtensionCatalogPackage[], trust: object = { state: 'unsigned' }) => ({
  store: { url }, trust, fetchedAt: 1, cached: false,
  listing: { entries: packages.map((item) => ({ install: { type: 'package', pkg: item } })) },
})

beforeAll(async () => {
  // Trigger vi.mock() factory functions to run before tests
  await Promise.all([
    import('$lib/store/feeds'),
    import('$lib/store/service'),
    import('$lib/store/origins'),
  ])
})

beforeEach(() => {
  mocks.fetchExtensionInfo.mockReset()
  mocks.installedExtensionPackages.mockReset()
  mocks.installCatalogPackage.mockReset().mockResolvedValue(undefined)
  mocks.loadStoreAndPin.mockReset()
  mocks.recordPackageOrigin.mockReset()
  mocks.extensionUrls.set(['https://x/index.json'])
  mocks.enabledExtensionUrls.set(['https://x/index.json'])
  mocks.allStores.set([])
  mocks.enabledStores.set([])
  mocks.packageOrigins.set({})
  mocks.playing.set(false)
  extensionUpdateNotice.set('')
})

describe('collectPackageUpdates', () => {
  const listing = (storeUrl: string, packages: ExtensionCatalogPackage[]) => ({ storeUrl, packages })

  it('returns only listed packages whose version differs from the install', () => {
    const updates = collectPackageUpdates(
      [inst('a', '1'), inst('b', '2')],
      [listing('https://s1.test/i.json', [pkg('a', '1'), pkg('b', '3'), pkg('c', '9')])],
    )
    expect(updates.map(({ entry, storeUrl }) => [entry.id, storeUrl])).toEqual([['b', 'https://s1.test/i.json']])
  })

  it('ignores installed packages no store lists', () => {
    expect(collectPackageUpdates([inst('side', '1')], [listing('https://s1.test/i.json', [pkg('a', '2')])])).toEqual([])
  })

  it('lets the first store listing an id win when the package has no recorded origin', () => {
    expect(collectPackageUpdates(
      [inst('a', '1')],
      [listing('https://s1.test/i.json', [pkg('a', '1')]), listing('https://s2.test/i.json', [pkg('a', '5')])],
    )).toEqual([])
  })

  it('only updates a package from the store it was installed from', () => {
    const listings = [listing('https://s1.test/i.json', [pkg('a', '9')]), listing('https://s2.test/i.json', [pkg('a', '2')])]
    expect(collectPackageUpdates([inst('a', '1')], listings, { a: 'https://s2.test/i.json' }).map(({ entry }) => entry.version)).toEqual(['2'])
    expect(collectPackageUpdates([inst('a', '1')], listings, { a: 'https://gone.test/i.json' })).toEqual([])
  })
})

describe('checkExtensionUpdates', () => {
  it('reinstalls outdated packages from a configured catalog and reports once', async () => {
    mocks.installedExtensionPackages.mockResolvedValue([inst('a', '1'), inst('b', '2')])
    mocks.fetchExtensionInfo.mockResolvedValue({ configs: [], packages: [pkg('a', '2', 'Alpha'), pkg('b', '2')] })
    const result = await checkExtensionUpdates()
    expect(mocks.installCatalogPackage).toHaveBeenCalledTimes(1)
    expect(mocks.installCatalogPackage.mock.calls[0][0].id).toBe('a')
    expect(result.updated.map((item) => item.id)).toEqual(['a'])
    expect(result.failed).toBe(0)
    expect(mocks.recordPackageOrigin).toHaveBeenCalledWith('a', 'https://x/index.json')
    expect(get(extensionUpdateNotice)).toContain('Alpha')
  })

  it('does not even fetch listings when nothing is installed', async () => {
    mocks.installedExtensionPackages.mockResolvedValue([])
    await checkExtensionUpdates()
    expect(mocks.fetchExtensionInfo).not.toHaveBeenCalled()
    expect(mocks.loadStoreAndPin).not.toHaveBeenCalled()
  })

  it('skips the whole check during playback — an install tears down the running workers', async () => {
    mocks.playing.set(true)
    mocks.installedExtensionPackages.mockResolvedValue([inst('a', '1')])
    mocks.fetchExtensionInfo.mockResolvedValue({ configs: [], packages: [pkg('a', '2')] })
    const result = await checkExtensionUpdates()
    expect(mocks.installCatalogPackage).not.toHaveBeenCalled()
    expect(result.reason).toBe('playback')
  })

  it('reports when configured catalogs cannot be reached', async () => {
    mocks.installedExtensionPackages.mockResolvedValue([inst('offline', '1')])
    mocks.fetchExtensionInfo.mockRejectedValue(new Error('offline'))
    const result = await checkExtensionUpdates({ retryAttempted: true })
    expect(result.reason).toBe('catalog-unavailable')
  })

  it('checks enabled stores even with no catalogs configured, skips the theme store, and records where updates came from', async () => {
    mocks.extensionUrls.set([])
    mocks.enabledExtensionUrls.set([])
    mocks.enabledStores.set([store('izumi-packages', 'https://store.test/index.json'), store('izumi-themes', 'https://store.test/themes.json')])
    mocks.installedExtensionPackages.mockResolvedValue([inst('store-package', '1')])
    mocks.loadStoreAndPin.mockResolvedValue(loaded('https://store.test/index.json', [pkg('store-package', '2')]))
    const result = await checkExtensionUpdates()
    expect(mocks.loadStoreAndPin).toHaveBeenCalledTimes(1)
    expect(mocks.loadStoreAndPin).toHaveBeenCalledWith(expect.objectContaining({ id: 'izumi-packages' }), { force: true })
    expect(result.updated.map((item) => item.id)).toEqual(['store-package'])
    expect(mocks.recordPackageOrigin).toHaveBeenCalledWith('store-package', 'https://store.test/index.json')
  })

  it('never updates from a store whose signing-key check failed', async () => {
    mocks.extensionUrls.set([])
    mocks.enabledExtensionUrls.set([])
    mocks.enabledStores.set([store('u-x', 'https://x.test/index.json')])
    mocks.installedExtensionPackages.mockResolvedValue([inst('locked-package', '1')])
    mocks.loadStoreAndPin.mockResolvedValue(loaded('https://x.test/index.json', [pkg('locked-package', '2')], { state: 'locked', reason: 'key-changed' }))
    expect(await checkExtensionUpdates()).toMatchObject({ updated: [], reason: 'catalog-unavailable' })
    expect(mocks.installCatalogPackage).not.toHaveBeenCalled()
  })

  it('lets an explicit check inspect disabled configured catalogs without enabling them', async () => {
    mocks.extensionUrls.set(['https://disabled.test/index.json'])
    mocks.enabledExtensionUrls.set([])
    mocks.installedExtensionPackages.mockResolvedValue([inst('disabled-catalog-package', '1')])
    mocks.fetchExtensionInfo.mockResolvedValue({ configs: [], packages: [pkg('disabled-catalog-package', '2')] })
    const result = await checkExtensionUpdates({ includeDisabledCatalogs: true })
    expect(mocks.fetchExtensionInfo).toHaveBeenCalledWith('https://disabled.test/index.json')
    expect(result.updated.map((item) => item.id)).toEqual(['disabled-catalog-package'])
  })

  it('lets an explicit check retry a package that failed earlier this session', async () => {
    mocks.installedExtensionPackages.mockResolvedValue([inst('manual-retry', '1')])
    mocks.fetchExtensionInfo.mockResolvedValue({ configs: [], packages: [pkg('manual-retry', '2')] })
    mocks.installCatalogPackage.mockRejectedValueOnce(new Error('temporary')).mockResolvedValueOnce(undefined)
    const first = await checkExtensionUpdates()
    const retried = await checkExtensionUpdates({ retryAttempted: true })
    expect(first.failed).toBe(1)
    expect(retried.updated.map((item) => item.id)).toEqual(['manual-retry'])
    expect(mocks.installCatalogPackage).toHaveBeenCalledTimes(2)
  })

  it('never retries the same id@version in one session, so a catalog whose version field disagrees with its package cannot reinstall-loop', async () => {
    mocks.installedExtensionPackages.mockResolvedValue([inst('loop', '1')])
    mocks.fetchExtensionInfo.mockResolvedValue({ configs: [], packages: [pkg('loop', '2')] })
    await checkExtensionUpdates()
    await checkExtensionUpdates()
    expect(mocks.installCatalogPackage).toHaveBeenCalledTimes(1)
  })

  it('keeps updating the rest when one package fails to install', async () => {
    mocks.installedExtensionPackages.mockResolvedValue([inst('bad', '1'), inst('good', '1')])
    mocks.fetchExtensionInfo.mockResolvedValue({ configs: [], packages: [pkg('bad', '2'), pkg('good', '2')] })
    mocks.installCatalogPackage.mockImplementation((p: ExtensionCatalogPackage) =>
      p.id === 'bad' ? Promise.reject(new Error('sha mismatch')) : Promise.resolve())
    await checkExtensionUpdates()
    expect(mocks.installCatalogPackage).toHaveBeenCalledTimes(2)
    expect(get(extensionUpdateNotice)).toBeTruthy()
  })
})
