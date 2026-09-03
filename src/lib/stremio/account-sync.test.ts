import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

const mocks = vi.hoisted(() => ({
  pullStremioAddons: vi.fn(),
  pushStremioAddons: vi.fn(),
  fetchManifest: vi.fn(),
}))

vi.mock('./account', async () => {
  const { writable } = await import('svelte/store')
  return {
    pullStremioAddons: mocks.pullStremioAddons,
    pushStremioAddons: mocks.pushStremioAddons,
    stremioAccountId: writable('account-a'),
    stremioAuthKey: writable<string | null>('session-key'),
  }
})
vi.mock('./manifest', () => ({ fetchManifest: mocks.fetchManifest }))

import { addonUrls, disabledSources } from './sources'
import { stremioAccountId, stremioAuthKey } from './account'
import {
  reconcileStremioAddonUrls,
  resetStremioAddonSync,
  stremioAddonSyncState,
  stremioTransportBase,
  stremioTransportUrl,
  syncStremioAddons,
} from './account-sync'

const descriptor = (
  id: string,
  transportUrl = `https://${id}.test/manifest.json`,
  flags: Record<string, unknown> = {},
) => ({ manifest: { id, name: id, version: '1.0.0' }, transportUrl, flags })

describe('Stremio add-on reconciliation', () => {
  beforeEach(() => {
    mocks.pullStremioAddons.mockReset()
    mocks.pushStremioAddons.mockReset()
    mocks.fetchManifest.mockReset()
    stremioAuthKey.set('session-key')
    stremioAccountId.set('account-a')
    addonUrls.set([])
    disabledSources.set([])
    resetStremioAddonSync()
  })

  it('round-trips manifest URLs without losing path-based or query configuration', () => {
    const transport = 'https://addon.test/user-token/manifest.json?quality=4k'
    expect(stremioTransportBase(transport)).toBe('https://addon.test/user-token?quality=4k')
    expect(stremioTransportUrl(stremioTransportBase(transport))).toBe(transport)
    expect(stremioTransportBase('http://localhost:7000/manifest.json')).toBe('')
  })

  it('uses a non-destructive union for the first sync and retains unsupported descriptors', () => {
    const legacy = descriptor('legacy', 'http://127.0.0.1:7000/manifest.json')
    const remote = descriptor('remote')
    const plan = reconcileStremioAddonUrls(['https://local.test'], [legacy, remote])

    expect(plan.urls).toEqual(['https://remote.test', 'https://local.test'])
    expect(plan.retainedDescriptors).toEqual([legacy, remote])
    expect(plan.descriptorBasesToCreate).toEqual(['https://local.test'])
    expect(plan.needsPush).toBe(true)
  })

  it('is scoped to Stremio add-on stores and never imports Izumi extension or debrid state', () => {
    const source = readFileSync(fileURLToPath(new URL('./account-sync.ts', import.meta.url)), 'utf8')
    expect(source).not.toContain('$lib/settings/ui')
    expect(source).not.toMatch(/\bextensionUrls\b|\bdisabledExtensions\b|\bdebridKey\b/)
  })

  it('propagates removals made on either side after a common baseline', () => {
    const remoteRemoved = reconcileStremioAddonUrls(
      ['https://one.test', 'https://two.test'],
      [descriptor('one')],
      ['https://one.test', 'https://two.test'],
    )
    expect(remoteRemoved.urls).toEqual(['https://one.test'])
    expect(remoteRemoved.needsPush).toBe(false)

    const localRemoved = reconcileStremioAddonUrls(
      ['https://one.test'],
      [descriptor('one'), descriptor('two')],
      ['https://one.test', 'https://two.test'],
    )
    expect(localRemoved.urls).toEqual(['https://one.test'])
    expect(localRemoved.retainedDescriptors).toEqual([descriptor('one')])
    expect(localRemoved.needsPush).toBe(true)
  })

  it('never removes a protected remote descriptor', () => {
    const protectedAddon = descriptor('protected', undefined, { official: true, protected: true })
    const plan = reconcileStremioAddonUrls([], [protectedAddon], ['https://protected.test'])

    expect(plan.urls).toEqual(['https://protected.test'])
    expect(plan.retainedDescriptors).toEqual([protectedAddon])
    expect(plan.needsPush).toBe(false)
  })

  it('preserves remote flags and unsupported entries while publishing a local delta', async () => {
    const protectedAddon = descriptor('protected', undefined, { official: true, protected: true })
    const legacy = descriptor('legacy', 'http://127.0.0.1:7000/manifest.json', { official: true })
    mocks.pullStremioAddons.mockResolvedValue({ addons: [protectedAddon, legacy] })
    mocks.fetchManifest.mockResolvedValue({ id: 'local', name: 'Local', version: '2.0.0', resources: ['stream'] })
    mocks.pushStremioAddons.mockResolvedValue(undefined)
    addonUrls.set(['https://local.test/private'])

    await expect(syncStremioAddons()).resolves.toEqual({ count: 2, pushed: true })

    expect(get(addonUrls)).toEqual(['https://protected.test', 'https://local.test/private'])
    expect(mocks.pushStremioAddons).toHaveBeenCalledWith([
      protectedAddon,
      legacy,
      {
        manifest: { id: 'local', name: 'Local', version: '2.0.0', resources: ['stream'] },
        transportUrl: 'https://local.test/private/manifest.json',
        flags: { official: false, protected: false },
      },
    ])
    expect(get(stremioAddonSyncState)).toMatchObject({ state: 'synced', count: 2, pushed: true })
  })

  it('does not publish when Stremio only removed an add-on', async () => {
    mocks.pullStremioAddons
      .mockResolvedValueOnce({ addons: [descriptor('one'), descriptor('two')] })
      .mockResolvedValueOnce({ addons: [descriptor('one')] })
    addonUrls.set(['https://one.test', 'https://two.test'])
    await syncStremioAddons()
    mocks.pushStremioAddons.mockClear()

    await syncStremioAddons()

    expect(get(addonUrls)).toEqual(['https://one.test'])
    expect(mocks.pushStremioAddons).not.toHaveBeenCalled()
  })

  it('aborts a write when a new local add-on has no valid manifest', async () => {
    mocks.pullStremioAddons.mockResolvedValue({ addons: [] })
    mocks.fetchManifest.mockResolvedValue(null)
    addonUrls.set(['https://broken.test/private-token'])

    await expect(syncStremioAddons()).rejects.toThrow('did not return a valid manifest')
    expect(mocks.pushStremioAddons).not.toHaveBeenCalled()
    expect(get(addonUrls)).toEqual(['https://broken.test/private-token'])
    expect(get(stremioAddonSyncState)).toMatchObject({ state: 'error' })
  })

  it('does not apply a pull that finishes after the account disconnects', async () => {
    let finishPull!: (value: { addons: ReturnType<typeof descriptor>[] }) => void
    mocks.pullStremioAddons.mockReturnValue(new Promise((resolve) => { finishPull = resolve }))
    addonUrls.set(['https://local.test'])
    const pending = syncStremioAddons()
    await vi.waitFor(() => expect(mocks.pullStremioAddons).toHaveBeenCalled())

    stremioAuthKey.set(null)
    stremioAccountId.set('')
    finishPull({ addons: [descriptor('remote')] })

    await expect(pending).rejects.toThrow('account changed')
    expect(get(addonUrls)).toEqual(['https://local.test'])
    expect(mocks.pushStremioAddons).not.toHaveBeenCalled()
    expect(get(stremioAddonSyncState)).toEqual({ state: 'idle' })
  })
})
