// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get, writable, type Writable } from 'svelte/store'

// Every package install goes through installCatalogPackage, so this is where a package is bound to
// the store it came from — and where a same-id package from anywhere else is refused as a takeover.

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  extensionUrls: null as unknown as Writable<string[]>,
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('$lib/net/http', () => ({ phttp: vi.fn(), invokeNativeHttp: vi.fn(), isNativeTransportFailure: () => false }))
vi.mock('$lib/stremio/online-cache', () => ({ clearProviderCache: vi.fn() }))
vi.mock('$lib/settings/ui', () => {
  mocks.extensionUrls = writable<string[]>([])
  return { extensionUrls: mocks.extensionUrls, enabledExtensionUrls: writable<string[]>([]), disabledPlugins: writable<string[]>([]) }
})

import { installCatalogPackage, removeInstalledExtension } from './manager'
import { OFFICIAL_ANIME_CATALOG, type ExtensionCatalogPackage } from './catalog'
import { legacyPackageStores, packageOrigins } from '$lib/store/origins'

const STORE = 'https://store.example.test/index.json'
const LATER = 'https://later.example.test/index.json'
const pkg: ExtensionCatalogPackage = {
  packageFormat: 'izumi-ext', id: 'example.pkg', name: 'Example', version: '2', nsfw: false, sources: [], backend: 'izumi-js',
  package: 'https://store.example.test/example.izumi-ext', packageSha256: 'a'.repeat(64), packageBytes: 1,
}
const onDisk = { id: 'example.pkg', name: 'Example', version: '1', backend: 'izumi-js', sourceId: 'example.pkg', sourceIds: ['example.pkg'], signed: false }

/** Answer the Rust commands: the installed list (or a failure reading it) and the install itself. */
function answer(installed: unknown[] | Error): void {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === 'extension_list') {
      if (installed instanceof Error) throw installed
      return installed
    }
    if (command === 'extension_install_url') return { ...onDisk, version: '2' }
    return undefined
  })
}
const installs = () => mocks.invoke.mock.calls.filter(([command]) => command === 'extension_install_url').length

beforeEach(() => {
  mocks.invoke.mockReset()
  mocks.extensionUrls.set([])
  packageOrigins.set({})
  legacyPackageStores.set(null)
})

describe('installCatalogPackage', () => {
  it('installs with the listing id and records the store the package came from', async () => {
    answer([])
    await installCatalogPackage(pkg, `${STORE}#top`)
    expect(mocks.invoke).toHaveBeenCalledWith('extension_install_url', expect.objectContaining({ expectedId: 'example.pkg' }))
    expect(get(packageOrigins)).toEqual({ 'example.pkg': STORE })
  })

  it('updates an installed package only from the store it came from', async () => {
    answer([onDisk])
    packageOrigins.set({ 'example.pkg': STORE })
    await expect(installCatalogPackage(pkg, LATER)).rejects.toThrow('installed from another store')
    expect(installs()).toBe(0)
    await installCatalogPackage(pkg, STORE)
    expect(installs()).toBe(1)
  })

  it('lets only the frozen legacy stores claim a package installed before origins existed', async () => {
    answer([onDisk])
    mocks.extensionUrls.set([STORE])
    await expect(installCatalogPackage(pkg, LATER)).rejects.toThrow('installed from another store')
    expect(get(legacyPackageStores)).toEqual([OFFICIAL_ANIME_CATALOG, STORE])
    // A catalog that joins the source list afterwards (as a Store install does) gains no claim.
    mocks.extensionUrls.set([STORE, LATER])
    await expect(installCatalogPackage(pkg, LATER)).rejects.toThrow('installed from another store')
    expect(installs()).toBe(0)
    await installCatalogPackage(pkg, STORE)
    expect(get(packageOrigins)).toEqual({ 'example.pkg': STORE })
  })

  it('ignores a leftover origin once the package is gone', async () => {
    answer([])
    packageOrigins.set({ 'example.pkg': LATER })
    await installCatalogPackage(pkg, STORE)
    expect(get(packageOrigins)).toEqual({ 'example.pkg': STORE })
  })

  it('refuses to install when the installed list cannot be read', async () => {
    answer(new Error('The package list could not be read.'))
    await expect(installCatalogPackage(pkg, STORE)).rejects.toThrow('could not be read')
    expect(installs()).toBe(0)
  })
})

describe('removeInstalledExtension', () => {
  it("forgets the removed package's store", async () => {
    answer([])
    packageOrigins.set({ 'example.pkg': STORE, 'other.pkg': LATER })
    await removeInstalledExtension('example.pkg')
    expect(get(packageOrigins)).toEqual({ 'other.pkg': LATER })
  })
})
