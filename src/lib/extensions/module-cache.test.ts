import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}))

vi.mock('idb-keyval', () => ({ get: mocks.get, set: mocks.set }))

import { loadCachedExtensionModule } from './module-cache'

const DAY = 24 * 60 * 60 * 1000
const module = { code: 'https://extensions.example/module.js', version: '2.0.0' }

describe('loadCachedExtensionModule', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    mocks.set.mockReset()
    mocks.set.mockResolvedValue(undefined)
  })

  it('uses a fresh version-matched module without a network request', async () => {
    mocks.get.mockResolvedValue({ ...module, url: module.code, code: 'cached code', fetchedAt: 10 * DAY })
    const fetchFresh = vi.fn()

    await expect(loadCachedExtensionModule(module, fetchFresh, 11 * DAY)).resolves.toBe('cached code')

    expect(fetchFresh).not.toHaveBeenCalled()
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('fetches immediately when the manifest version changes', async () => {
    mocks.get.mockResolvedValue({ url: module.code, version: '1.0.0', code: 'old code', fetchedAt: 10 * DAY })
    const fetchFresh = vi.fn().mockResolvedValue('new code')

    await expect(loadCachedExtensionModule(module, fetchFresh, 11 * DAY)).resolves.toBe('new code')

    expect(fetchFresh).toHaveBeenCalledOnce()
    expect(mocks.set).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      version: '2.0.0',
      code: 'new code',
    }))
  })

  it('refreshes a week-old versioned module', async () => {
    mocks.get.mockResolvedValue({ url: module.code, version: module.version, code: 'old code', fetchedAt: 0 })
    const fetchFresh = vi.fn().mockResolvedValue('new code')

    await expect(loadCachedExtensionModule(module, fetchFresh, 8 * DAY)).resolves.toBe('new code')
    expect(fetchFresh).toHaveBeenCalledOnce()
  })

  it('refreshes an unversioned module daily', async () => {
    const unversioned = { code: module.code }
    mocks.get.mockResolvedValue({ url: module.code, version: null, code: 'old code', fetchedAt: 0 })
    const fetchFresh = vi.fn().mockResolvedValue('new code')

    await expect(loadCachedExtensionModule(unversioned, fetchFresh, 2 * DAY)).resolves.toBe('new code')
    expect(fetchFresh).toHaveBeenCalledOnce()
  })

  it('falls back to a compatible stale module when refresh fails', async () => {
    mocks.get.mockResolvedValue({ url: module.code, version: module.version, code: 'stale code', fetchedAt: 0 })
    const fetchFresh = vi.fn().mockRejectedValue(new Error('offline'))

    await expect(loadCachedExtensionModule(module, fetchFresh, 8 * DAY)).resolves.toBe('stale code')
  })

  it('still fetches when IndexedDB is unavailable', async () => {
    mocks.get.mockRejectedValue(new Error('storage blocked'))
    const fetchFresh = vi.fn().mockResolvedValue('network code')

    await expect(loadCachedExtensionModule(module, fetchFresh, DAY)).resolves.toBe('network code')
    expect(fetchFresh).toHaveBeenCalledOnce()
  })
})
