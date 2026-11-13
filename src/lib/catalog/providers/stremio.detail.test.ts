import { describe, expect, it, vi } from 'vitest'
import { readable } from 'svelte/store'

const CINEMETA = 'https://v3-cinemeta.strem.io'
const responses = new Map<string, unknown>()

vi.mock('$lib/net/http', () => ({
  phttp: async (url: string) => {
    const body = responses.get(url)
    return { ok: body != null, status: body == null ? 404 : 200, json: async () => body }
  },
}))
vi.mock('$lib/stremio/sources', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  enabledAddonUrls: readable([`${CINEMETA}/manifest.json`]),
}))
vi.mock('$lib/stremio/manifest', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchManifest: async () => ({
    id: 'cinemeta', name: 'Cinemeta', resources: ['catalog', 'meta'], types: ['series'],
    catalogs: [{ type: 'series', id: 'top', extra: [{ name: 'search' }] }],
  }),
}))

const { stremioCatalog } = await import('./stremio')

describe('Stremio catalog detail', () => {
  it('loads Cinemeta episodes when Cinemeta supplied a card under an older title', async () => {
    // Cinemeta's search index can carry an older English title than its meta route.
    responses.set(`${CINEMETA}/catalog/series/top/search=Example%20Drama.json`, {
      metas: [{ id: 'tt0000001', type: 'series', name: 'Former Example Title', releaseInfo: '2026' }],
    })
    responses.set(`${CINEMETA}/meta/series/tt0000001.json`, {
      meta: {
        id: 'tt0000001', type: 'series', name: 'Example Drama', releaseInfo: '2026',
        videos: [{ id: 'tt0000001:1:1', season: 1, episode: 1 }, { id: 'tt0000001:1:2', season: 1, episode: 2 }],
      },
    })

    const page = await stremioCatalog.search!({ query: 'Example Drama', type: 'series' })
    const media = await stremioCatalog.detail!(page.media[0].catalog!)

    expect(media?.title.userPreferred).toBe('Example Drama')
    expect(media?.videos?.map((video) => video.id)).toEqual(['tt0000001:1:1', 'tt0000001:1:2'])
  })

  it('keeps the Cinemeta card when its meta route answers with a stale record from another year', async () => {
    responses.set(`${CINEMETA}/catalog/series/top/search=Example%20Saga.json`, {
      metas: [{ id: 'tt0000002', type: 'series', name: 'Example Saga', releaseInfo: '2024' }],
    })
    responses.set(`${CINEMETA}/meta/series/tt0000002.json`, {
      meta: { id: 'tt0000002', type: 'series', name: 'Unrelated Old Record', releaseInfo: '1938' },
    })

    const page = await stremioCatalog.search!({ query: 'Example Saga', type: 'series' })
    const media = await stremioCatalog.detail!(page.media[0].catalog!)

    expect(media?.title.userPreferred).toBe('Example Saga')
  })
})
