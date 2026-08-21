import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

// The queue must run each job through the engine that actually owns the source. A P2P/direct
// preference with no debrid credential is a fully supported setup, so it has to produce a real
// download attempt through the native torrent engine — never a "add a debrid key" dead end.

const invoke = vi.fn(async (command: string, _args?: Record<string, unknown>) =>
  (command === 'download_dir_default' ? '/downloads' : undefined))
const resolveDownloadUrl = vi.fn()
const storeShakaOffline = vi.fn()
const abortShakaOffline = vi.fn(async () => {})
const removeShakaOffline = vi.fn(async () => {})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string, args?: Record<string, unknown>) => invoke(command, args),
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))
vi.mock('$lib/stremio/play', () => ({ resolveDownloadUrl: (...a: unknown[]) => resolveDownloadUrl(...a) }))
vi.mock('./shaka-offline', () => ({
  storeShakaOffline: (...a: unknown[]) => storeShakaOffline(...a),
  abortShakaOffline: (...a: unknown[]) => abortShakaOffline(...a),
  removeShakaOffline: (...a: unknown[]) => removeShakaOffline(...a),
}))
vi.mock('$lib/anizip', () => ({ getEpisodeMeta: async () => ({}) }))
vi.mock('$lib/player/direct-torrent', () => ({
  torrentEngineNetworkOptions: () => ({ downloadLimitMbps: 0, upstreamCapacityMbps: null, socksProxyUrl: null }),
}))

const { downloads } = await import('./state')
const { enqueue, pauseDownload, cancelDownload } = await import('./store')

const media = {
  id: 7,
  title: { userPreferred: 'Test Anime', romaji: 'Test Anime' },
  coverImage: { extraLarge: 'https://img/cover.jpg' },
} as never

const MAGNET = 'magnet:?xt=urn:btih:aabbccddeeff00112233445566778899aabbccdd'

const torrentResolution = {
  kind: 'torrent',
  magnet: MAGNET,
  filename: 'Test Anime - E2.mkv',
  preferredFilename: 'Test Anime - 02 [1080p].mkv',
  episode: 2,
  absoluteEpisode: 2,
  season: 1,
  infoHash: 'aabbccddeeff00112233445566778899aabbccdd',
}

const calls = (command: string) => invoke.mock.calls.filter(([name]) => name === command)
/** `pump` flips the item to `downloading` synchronously, so wait for the engine call itself. */
const settle = () => vi.waitFor(() =>
  expect(calls('download_start').length + calls('torrent_download_start').length).toBe(1))

beforeEach(() => {
  downloads.set({})
  invoke.mockClear()
  resolveDownloadUrl.mockReset()
  storeShakaOffline.mockReset()
  abortShakaOffline.mockClear()
  removeShakaOffline.mockClear()
})

afterEach(() => {
  downloads.set({})
})

describe('download queue engine routing', () => {
  it('starts a real P2P download when the pick is a torrent and no debrid key exists', async () => {
    resolveDownloadUrl.mockResolvedValue(torrentResolution)

    enqueue(media, 2)
    await settle()

    expect(calls('download_start')).toHaveLength(0)
    expect(calls('torrent_download_start')).toHaveLength(1)
    expect(calls('torrent_download_start')[0][1]).toMatchObject({
      id: '7:2',
      magnet: MAGNET,
      dir: '/downloads',
      filename: 'Test Anime - E2.mkv',
      preferredFilename: 'Test Anime - 02 [1080p].mkv',
      episode: 2,
      absoluteEpisode: 2,
      season: 1,
    })
    expect(get(downloads)['7:2']).toMatchObject({ kind: 'torrent', status: 'downloading' })
    expect(get(downloads)['7:2'].error).toBeUndefined()
  })

  it('still streams an http/debrid resolution over the plain download path', async () => {
    resolveDownloadUrl.mockResolvedValue({
      kind: 'http', url: 'https://debrid.example/file.mkv', filename: 'Test Anime - E2.mkv', provider: 'Real-Debrid',
    })

    enqueue(media, 2)
    await settle()

    expect(calls('torrent_download_start')).toHaveLength(0)
    expect(calls('download_start')[0][1]).toMatchObject({ id: '7:2', url: 'https://debrid.example/file.mkv' })
    expect(get(downloads)['7:2']).toMatchObject({ kind: 'http' })
  })

  it('stores adaptive DRM through Shaka and persists its offline manifest', async () => {
    resolveDownloadUrl.mockResolvedValue({
      kind: 'shaka',
      url: 'http://127.0.0.1/manifest.mpd',
      drm: { keySystem: 'com.widevine.alpha', licenseUrl: 'http://127.0.0.1/license' },
      filename: 'Test Anime - E2.mkv',
    })
    storeShakaOffline.mockImplementation(async (_id, _resolution, progress) => {
      progress({ downloaded: 50, bytes: 100, speed: 10 })
      return {
        offlineUri: 'offline:manifest/idb/main/1',
        bytes: 100,
        drmKeySystem: 'com.widevine.alpha',
        persistentLicense: false,
      }
    })

    enqueue(media, 2)
    await vi.waitFor(() => expect(get(downloads)['7:2']?.status).toBe('done'))

    expect(calls('download_start')).toHaveLength(0)
    expect(calls('torrent_download_start')).toHaveLength(0)
    expect(get(downloads)['7:2']).toMatchObject({
      kind: 'shaka',
      offlineUri: 'offline:manifest/idb/main/1',
      downloaded: 100,
      bytes: 100,
      requiresOnlineLicense: true,
      sourceOriginId: undefined,
    })
  })

  it('keeps a persistent CDM license when the device can store one', async () => {
    resolveDownloadUrl.mockResolvedValue({
      kind: 'shaka',
      url: 'http://127.0.0.1/manifest.mpd',
      drm: { keySystem: 'com.widevine.alpha', licenseUrl: 'http://127.0.0.1/license' },
      filename: 'Test Anime - E2.mkv',
      sourceOriginId: 'source.izumi',
    })
    storeShakaOffline.mockResolvedValue({
      offlineUri: 'offline:manifest/idb/main/2',
      bytes: 50,
      drmKeySystem: 'com.widevine.alpha',
      persistentLicense: true,
    })

    enqueue(media, 2)
    await vi.waitFor(() => expect(get(downloads)['7:2']?.status).toBe('done'))

    expect(get(downloads)['7:2']).toMatchObject({
      kind: 'shaka',
      requiresOnlineLicense: false,
      sourceOriginId: 'source.izumi',
      preferences: { sourceOriginId: 'source.izumi' },
    })
  })

  it('pauses and cancels a torrent job through the torrent engine', async () => {
    resolveDownloadUrl.mockResolvedValue(torrentResolution)

    enqueue(media, 2)
    await settle()

    await pauseDownload('7:2')
    expect(calls('download_cancel')).toHaveLength(0)
    expect(calls('torrent_download_cancel')[0][1]).toMatchObject({ id: '7:2', deleteFiles: false })
    expect(get(downloads)['7:2'].status).toBe('paused')

    await cancelDownload('7:2')
    expect(calls('torrent_download_cancel')[1][1]).toMatchObject({ id: '7:2', deleteFiles: true })
    expect(get(downloads)['7:2']).toBeUndefined()
  })

  it('keeps routing items queued before the torrent engine existed to the http path', async () => {
    // Persisted items from older builds carry no `kind`; they were all debrid downloads.
    downloads.set({ '7:2': {
      id: '7:2', mediaId: 7, episode: 2, title: 'Test Anime — E2', filename: 'old.mkv',
      bytes: 0, downloaded: 0, status: 'paused', addedAt: 0,
    } })

    await cancelDownload('7:2')

    expect(calls('torrent_download_cancel')).toHaveLength(0)
    expect(calls('download_cancel')[0][1]).toMatchObject({ id: '7:2', deletePart: true, filename: 'old.mkv' })
  })
})

describe('download failure copy', () => {
  it('surfaces the real reason a job failed rather than a credential demand', async () => {
    resolveDownloadUrl.mockRejectedValue(new Error('That source has no downloadable link.'))

    enqueue(media, 2)
    await vi.waitFor(() => expect(get(downloads)['7:2']?.status).toBe('error'))

    expect(get(downloads)['7:2'].error).toBe('That source has no downloadable link.')
    expect(get(downloads)['7:2'].error).not.toMatch(/debrid|key/i)
  })
})
