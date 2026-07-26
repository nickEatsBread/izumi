import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ phttp: vi.fn() }))

vi.mock('$lib/net/http', () => ({ phttp: mocks.phttp }))

import { fetchManifest } from './manifest'

describe('addon manifest cache', () => {
  beforeEach(() => mocks.phttp.mockReset())

  it('keeps successful manifests cached', async () => {
    mocks.phttp.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'cached', name: 'Cached', version: '1.0.0' }),
    })

    await fetchManifest('cached-manifest.test')
    await fetchManifest('https://cached-manifest.test/manifest.json')

    expect(mocks.phttp).toHaveBeenCalledTimes(1)
  })

  it('retries after a transient non-success response', async () => {
    mocks.phttp
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'recovered', name: 'Recovered', version: '1.0.0' }),
      })

    expect(await fetchManifest('retry-manifest.test')).toBeNull()
    await expect(fetchManifest('retry-manifest.test')).resolves.toMatchObject({ id: 'recovered' })
    expect(mocks.phttp).toHaveBeenCalledTimes(2)
  })

  it('retries after malformed JSON', async () => {
    mocks.phttp
      .mockResolvedValueOnce({ ok: true, json: async () => { throw new SyntaxError('bad json') } })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'valid', name: 'Valid', version: '1.0.0' }),
      })

    expect(await fetchManifest('parse-retry-manifest.test')).toBeNull()
    await expect(fetchManifest('parse-retry-manifest.test')).resolves.toMatchObject({ id: 'valid' })
  })
})
