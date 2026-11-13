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
const enabled = { urls: [`${CINEMETA}/manifest.json`] }
vi.mock('$lib/stremio/sources', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  enabledAddonUrls: { subscribe: (run: (value: string[]) => void) => { run(enabled.urls); return () => {} } },
}))
const CINEMETA_MANIFEST = {
  id: 'cinemeta', name: 'Cinemeta', resources: ['catalog', 'meta'], types: ['series'],
  catalogs: [{ type: 'series', id: 'top', extra: [{ name: 'search' }] }],
}
const manifests = new Map<string, unknown>()
vi.mock('$lib/stremio/manifest', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchManifest: async (base: string) => manifests.get(base.replace(/\/manifest\.json$/, '')) ?? CINEMETA_MANIFEST,
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

  it('asks another add-on that serves the meta when the catalog that supplied the card has none', async () => {
    enabled.urls = ['https://lists.test/manifest.json', 'https://anime-meta.test/manifest.json']
    manifests.set('https://lists.test', { id: 'lists', name: 'Lists', resources: ['catalog'], catalogs: [{ type: 'series', id: 'picks', extraSupported: ['search'] }] })
    manifests.set('https://anime-meta.test', { id: 'meta', name: 'Meta', resources: [{ name: 'meta', types: ['series'], idPrefixes: ['kitsu:'] }] })
    responses.set('https://lists.test/catalog/series/picks/search=Example%20Anime.json', {
      metas: [{ id: 'kitsu:1', type: 'series', name: 'Example Anime' }],
    })
    responses.set('https://anime-meta.test/meta/series/kitsu%3A1.json', {
      meta: { id: 'kitsu:1', type: 'series', name: 'Example Anime', videos: [{ id: 'kitsu:1:1', season: 1, episode: 1 }] },
    })

    // The legacy `extraSupported` declaration is searchable, and page 1 sends no `skip`.
    const page = await stremioCatalog.search!({ query: 'Example Anime', type: 'series' })
    const media = await stremioCatalog.detail!(page.media[0].catalog!)

    expect(media?.videos?.map((video) => video.id)).toEqual(['kitsu:1:1'])
  })

  it('plays a meta with no videos through its default video id', async () => {
    enabled.urls = ['https://channels.test/manifest.json']
    manifests.set('https://channels.test', { id: 'ch', name: 'Channels', resources: ['catalog', 'meta'], catalogs: [{ type: 'tv', id: 'live', extra: [{ name: 'search' }] }] })
    responses.set('https://channels.test/catalog/tv/live/search=Example%20Channel.json', {
      metas: [{ id: 'ch:1', type: 'tv', name: 'Example Channel' }],
    })
    responses.set('https://channels.test/meta/tv/ch%3A1.json', {
      meta: { id: 'ch:1', type: 'tv', name: 'Example Channel', behaviorHints: { defaultVideoId: 'ch:1:live' } },
    })

    const page = await stremioCatalog.search!({ query: 'Example Channel', type: 'all' })
    const media = await stremioCatalog.detail!(page.media[0].catalog!)

    expect(media?.videos?.map((video) => video.id)).toEqual(['ch:1:live'])
  })
})
