import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get, writable } from 'svelte/store'

// Background auto-update for installed .izumi-ext packages: compare installed versions against the
// live catalogs, reinstall what changed, say so once. The catalog is the canonical version — a
// repo rollback is applied the same way as an upgrade.

const mocks = vi.hoisted(() => ({
  fetchExtensionInfo: vi.fn(),
  installedExtensionPackages: vi.fn(),
  installCatalogPackage: vi.fn(),
  extensionUrls: null as unknown as ReturnType<typeof writable<string[]>>,
  enabledExtensionUrls: null as unknown as ReturnType<typeof writable<string[]>>,
  playing: null as unknown as ReturnType<typeof writable<boolean>>,
}))

vi.mock('./manager', () => ({
  fetchExtensionInfo: mocks.fetchExtensionInfo,
  installedExtensionPackages: mocks.installedExtensionPackages,
  installCatalogPackage: mocks.installCatalogPackage,
  OFFICIAL_ANIME_CATALOG: 'https://store.test/index.json',
}))
vi.mock('$lib/settings/ui', () => {
  mocks.extensionUrls = writable<string[]>([])
  mocks.enabledExtensionUrls = writable<string[]>([])
  return { extensionUrls: mocks.extensionUrls, enabledExtensionUrls: mocks.enabledExtensionUrls }
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

beforeEach(() => {
  mocks.fetchExtensionInfo.mockReset()
  mocks.installedExtensionPackages.mockReset()
  mocks.installCatalogPackage.mockReset().mockResolvedValue(undefined)
  mocks.extensionUrls.set(['https://x/index.json'])
  mocks.enabledExtensionUrls.set(['https://x/index.json'])
  mocks.playing.set(false)
  extensionUpdateNotice.set('')
})

describe('collectPackageUpdates', () => {
  it('returns only the catalog packages whose version differs from the install', () => {
    const updates = collectPackageUpdates(
      [inst('a', '1'), inst('b', '2')],
      [[pkg('a', '1'), pkg('b', '3'), pkg('c', '9')]],
    )
    expect(updates.map((p) => p.id)).toEqual(['b'])
  })

  it('ignores installed packages no catalog lists', () => {
    expect(collectPackageUpdates([inst('side', '1')], [[pkg('a', '2')]])).toEqual([])
  })

  it('lets the first catalog listing an id win, matching install precedence in settings', () => {
    const updates = collectPackageUpdates(
      [inst('a', '1')],
      [[pkg('a', '1')], [pkg('a', '5')]],
    )
    expect(updates).toEqual([])
  })
})

describe('checkExtensionUpdates', () => {
  it('reinstalls outdated packages from the catalog and reports once', async () => {
    mocks.installedExtensionPackages.mockResolvedValue([inst('a', '1'), inst('b', '2')])
    mocks.fetchExtensionInfo.mockResolvedValue({ configs: [], packages: [pkg('a', '2', 'Alpha'), pkg('b', '2')] })
    const result = await checkExtensionUpdates()
    expect(mocks.installCatalogPackage).toHaveBeenCalledTimes(1)
    expect(mocks.installCatalogPackage.mock.calls[0][0].id).toBe('a')
    expect(result.updated.map((item) => item.id)).toEqual(['a'])
    expect(result.failed).toBe(0)
    expect(get(extensionUpdateNotice)).toContain('Alpha')
  })

  it('does not even fetch catalogs when nothing is installed', async () => {
    mocks.installedExtensionPackages.mockResolvedValue([])
    await checkExtensionUpdates()
    expect(mocks.fetchExtensionInfo).not.toHaveBeenCalled()
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

  it('checks the built-in Store catalog for an explicit check even when no catalogs are configured', async () => {
    mocks.extensionUrls.set([])
    mocks.enabledExtensionUrls.set([])
    mocks.installedExtensionPackages.mockResolvedValue([inst('store-package', '1')])
    mocks.fetchExtensionInfo.mockResolvedValue({ configs: [], packages: [pkg('store-package', '1')] })
    const result = await checkExtensionUpdates({ includeOfficialCatalog: true })
    expect(mocks.fetchExtensionInfo).toHaveBeenCalledWith('https://store.test/index.json')
    expect(result.reason).toBeUndefined()
    expect(result.updated).toEqual([])
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
    await checkExtensionUpdates() // installed list still says v1 — a real apply would now say v2
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
