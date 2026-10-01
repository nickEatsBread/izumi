// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get, writable } from 'svelte/store'

// A restricted profile needs the main profile's PIN before a NEW 18+ package lands on disk. A
// package already installed keeps updating, reinstalling and being replaced (spec §6.6).

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  adultSourcesPermitted: vi.fn(() => false),
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('$lib/net/http', () => ({ phttp: vi.fn(), invokeNativeHttp: vi.fn(), isNativeTransportFailure: () => false }))
vi.mock('$lib/stremio/online-cache', () => ({ clearProviderCache: vi.fn() }))
vi.mock('$lib/settings/ui', () => ({
  extensionUrls: writable<string[]>([]),
  enabledExtensionUrls: writable<string[]>([]),
  disabledPlugins: writable<string[]>([]),
}))
vi.mock('$lib/profiles/household-gate', () => ({
  ADULT_SOURCES_LOCKED_MESSAGE: 'Unlock 18+ sources with the main profile PIN first.',
  adultSourcesPermitted: mocks.adultSourcesPermitted,
}))

import { installCatalogPackage } from './manager'
import type { IzumiCatalogPackage } from './catalog'
import { legacyPackageStores, packageOrigins } from '$lib/store/origins'

const STORE = 'https://store.example.test/index.json'
const LATER = 'https://later.example.test/index.json'
const adultPackage: IzumiCatalogPackage = {
  packageFormat: 'izumi-ext', id: 'adult.pkg', name: 'Adult Example', version: '2', nsfw: true, sources: [], backend: 'izumi-js',
  package: 'https://store.example.test/adult.izumi-ext', packageSha256: 'a'.repeat(64), packageBytes: 1,
}
const familyPackage: IzumiCatalogPackage = { ...adultPackage, id: 'family.pkg', name: 'Family Example', nsfw: false }
const onDisk = { id: 'adult.pkg', name: 'Adult Example', version: '1', backend: 'izumi-js', sourceId: 'adult.pkg', sourceIds: ['adult.pkg'], signed: false }

/** Answer the Rust commands: the installed list and the install itself. */
function answer(installed: unknown[]): void {
  mocks.invoke.mockImplementation(async (command: string, args?: { expectedId?: string }) => {
    if (command === 'extension_list') return installed
    if (command === 'extension_install_url') return { ...onDisk, id: args?.expectedId ?? onDisk.id, version: '2' }
    return undefined
  })
}
const installs = () => mocks.invoke.mock.calls.filter(([command]) => command === 'extension_install_url').length

beforeEach(() => {
  mocks.invoke.mockReset()
  mocks.adultSourcesPermitted.mockReset().mockReturnValue(false)
  packageOrigins.set({})
  legacyPackageStores.set(null)
})

describe('installCatalogPackage and 18+ packages', () => {
  it('refuses a new 18+ package while 18+ sources are locked, before downloading anything', async () => {
    answer([])
    await expect(installCatalogPackage(adultPackage, STORE)).rejects.toThrow('Unlock 18+ sources with the main profile PIN first.')
    expect(installs()).toBe(0)
    expect(get(packageOrigins)).toEqual({})
  })

  it('installs a new 18+ package once 18+ sources are unlocked', async () => {
    mocks.adultSourcesPermitted.mockReturnValue(true)
    answer([])
    await installCatalogPackage(adultPackage, STORE)
    expect(installs()).toBe(1)
  })

  it('keeps updating and reinstalling an 18+ package that is already installed', async () => {
    answer([onDisk])
    packageOrigins.set({ 'adult.pkg': STORE })
    await installCatalogPackage(adultPackage, STORE)
    await installCatalogPackage(adultPackage, STORE, { updateOnly: true })
    expect(installs()).toBe(2)
    expect(mocks.adultSourcesPermitted).not.toHaveBeenCalled()
  })

  it('still replaces an installed 18+ package from another store once the user confirms', async () => {
    answer([onDisk])
    packageOrigins.set({ 'adult.pkg': LATER })
    await installCatalogPackage(adultPackage, STORE, { replaceInstalled: true })
    expect(mocks.invoke).toHaveBeenCalledWith('extension_install_url', expect.objectContaining({ replaceInstalled: true }))
  })

  it('never asks about packages that are not 18+', async () => {
    answer([])
    await installCatalogPackage(familyPackage, STORE)
    expect(installs()).toBe(1)
    expect(mocks.adultSourcesPermitted).not.toHaveBeenCalled()
  })
})
