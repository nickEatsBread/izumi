import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readable } from 'svelte/store'

// What a stored source spec resolves to for the settings list. A package catalog and a manifest are
// added the same way — by URL — so the classification below is the only thing deciding which row
// the user gets.

const mocks = vi.hoisted(() => ({ phttp: vi.fn(), invoke: vi.fn() }))

vi.mock('$lib/net/http', () => ({ phttp: mocks.phttp }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('$lib/settings/ui', () => ({ enabledExtensionUrls: readable([]), disabledPlugins: readable([]) }))
vi.mock('$lib/stremio/online-cache', () => ({ clearProviderCache: () => {} }))

import { fetchExtensionInfo } from './manager'

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) })

const CATALOG = {
  formatVersion: 1,
  generatedAt: '2026-07-26T20:14:38.418Z',
  scope: { content: 'anime', transport: 'http', manga: false },
  packages: [
    { id: 'a', name: 'A', version: '1', nsfw: false, sources: [], backend: 'izumi-js', package: 'https://x/a.izumi-ext', packageSha256: 'aa', packageBytes: 1 },
  ],
}

beforeEach(() => {
  mocks.phttp.mockReset()
})

describe('fetchExtensionInfo', () => {
  it('reads a package catalog as installable packages, not as a manifest that produced nothing', () => {
    mocks.phttp.mockResolvedValue(ok(CATALOG))
    return fetchExtensionInfo('https://x/index.json').then((info) => {
      expect(info.packages?.map((p) => p.id)).toEqual(['a'])
      expect(info.configs).toEqual([])
      expect(info.problem).toBeUndefined()
    })
  })

  it('classifies and expands in a SINGLE fetch', async () => {
    // The old shape fetched once to expand and a second time to explain a failure, doubling the
    // request count for every source in the list.
    mocks.phttp.mockResolvedValue(ok([{ id: 'x', name: 'X', type: 'torrent', code: 'https://x/x.js' }]))
    const info = await fetchExtensionInfo('https://x/index.json')
    expect(info.configs.map((c) => c.id)).toEqual(['x'])
    expect(mocks.phttp).toHaveBeenCalledTimes(1)
  })

  it('reports an unreachable URL rather than an empty list', async () => {
    mocks.phttp.mockResolvedValue({ ok: false, status: 404, json: async () => ({}), text: async () => '' })
    expect((await fetchExtensionInfo('https://x/index.json')).problem).toBe('That URL returned HTTP 404.')
  })

  it('explains a manifest that carries nothing runnable', async () => {
    mocks.phttp.mockResolvedValue(ok([{ id: 'm', name: 'M', type: 'manga-provider', payloadURI: 'https://x/m.js' }]))
    const info = await fetchExtensionInfo('https://x/index.json')
    expect(info.configs).toEqual([])
    expect(info.problem).toMatch(/can't run/i)
  })
})
