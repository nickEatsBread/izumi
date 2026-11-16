import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

// The queue must run each job through the engine that actually owns the source. A P2P/direct
// preference with no debrid credential is a fully supported setup, so it has to produce a real
// download attempt through the native torrent engine — never a "add a debrid key" dead end.

const invoke = vi.fn(async (command: string, _args?: Record<string, unknown>): Promise<unknown> =>
  (command === 'download_dir_default' ? '/downloads' : undefined))
const resolveDownloadUrl = vi.fn()
const storeShakaOffline = vi.fn()
const abortShakaOffline = vi.fn(async (..._args: unknown[]) => {})
const removeShakaOffline = vi.fn(async (..._args: unknown[]) => {})

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
const nativeDrm = { on: false }
vi.mock('$lib/player/native-drm', () => ({
  NOT_INSTALLED: 'widevine-not-installed',
  PROTECTED_SAVE_SETUP: "Protected episodes can't be saved on this device yet. Set up Protected video in Settings › Playback, then try again.",
  usesNativeDrm: (drm: { licenseUrl?: string } | undefined) => nativeDrm.on && !!drm?.licenseUrl,
}))
vi.mock('$lib/net/http', () => ({
  invokeNativeHttp: (command: string, args: Record<string, unknown>) => invoke(command, args),
}))
vi.mock('$lib/player/direct-torrent', () => ({
  torrentEngineNetworkOptions: () => ({ downloadLimitMbps: 0, upstreamCapacityMbps: null, socksProxyUrl: null }),
}))

const { downloads } = await import('./state')
const { attachDownloadEvents, enqueue, pauseDownload, resumeDownload, cancelDownload } = await import('./store')

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
  it('leaves native download setup inactive outside the desktop/mobile runtime', () => {
    expect(() => attachDownloadEvents()).not.toThrow()
    expect(invoke).not.toHaveBeenCalled()
  })

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

  it('tells the native HTTP engine to assemble HLS media segments', async () => {
    resolveDownloadUrl.mockResolvedValue({
      kind: 'http',
      url: 'http://localhost:39123/m3u8?url=episode.m3u8',
      filename: 'Test Anime - E2.ts',
      headers: { Referer: 'https://provider.example/' },
      hls: true,
      preferredHeight: 720,
    })

    enqueue(media, 2)
    await settle()

    expect(calls('download_start')[0][1]).toMatchObject({
      hls: true,
      preferredHeight: 720,
      filename: 'Test Anime - E2.ts',
      headers: { Referer: 'https://provider.example/' },
    })
    expect(get(downloads)['7:2']).toMatchObject({ hls: true })

    await pauseDownload('7:2')
    downloads.update((items) => ({ ...items, '7:2': { ...items['7:2'], downloaded: 25_000_000, bytes: 100_000_000 } }))
    resumeDownload('7:2')
    expect(get(downloads)['7:2']).toMatchObject({ downloaded: 0, bytes: 0 })
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

describe('protected episodes on Linux, through the native Widevine module', () => {
  const shaka = {
    kind: 'shaka',
    url: 'http://127.0.0.1:4000/v/1/manifest.mpd?offline=1',
    drm: { keySystem: 'com.widevine.alpha', licenseUrl: 'http://127.0.0.1:4000/v/1/license', releaseUrl: 'http://127.0.0.1:4000/v/1/session' },
    filename: 'Test Anime - E2.mkv',
    preferredHeight: 1080,
    sourceOriginId: 'example.source',
  }

  afterEach(() => { nativeDrm.on = false })

  it('decrypts the episode to clear files natively instead of storing them in the webview, then frees the session', async () => {
    nativeDrm.on = true
    resolveDownloadUrl.mockResolvedValue(shaka)
    invoke.mockImplementation(async (command: string) => command === 'download_dir_default' ? '/downloads'
      : command === 'widevine_save_folder' ? '/downloads/Test Anime - E2.protected'
      : command === 'widevine_save' ? { path: '/downloads/Test Anime - E2.protected', bytes: 600, height: 1080 }
      : command === 'ext_fetch' ? { status: 200, body: '' } : undefined)

    enqueue(media, 2)
    await vi.waitFor(() => expect(get(downloads)['7:2']?.status).toBe('done'))

    expect(storeShakaOffline).not.toHaveBeenCalled()
    // The module needs the source's licence request (drm) to obtain the content keys for the decrypt.
    expect(calls('widevine_save')[0]?.[1]).toMatchObject({ id: '7:2', manifestUrl: shaka.url, dir: '/downloads', name: shaka.filename, maxHeight: 1080, drm: shaka.drm })
    expect(get(downloads)['7:2']).toMatchObject({
      // The saved files are clear, so playback needs no online licence.
      kind: 'drm-local', path: '/downloads/Test Anime - E2.protected', requiresOnlineLicense: false,
      sourceOriginId: 'example.source', quality: '1080p', bytes: 600,
    })
    await vi.waitFor(() => expect(calls('ext_fetch')[0]?.[1]).toMatchObject({ url: shaka.drm.releaseUrl, method: 'DELETE' }))
  })

  it('says where to set protected video up when the module is not set up, instead of the raw code', async () => {
    nativeDrm.on = true
    resolveDownloadUrl.mockResolvedValue(shaka)
    invoke.mockImplementation(async (command: string) => {
      if (command === 'widevine_save') throw new Error('widevine-not-installed')
      return command === 'download_dir_default' ? '/downloads'
        : command === 'widevine_save_folder' ? '/downloads/Test Anime - E2.protected'
        : command === 'ext_fetch' ? { status: 200, body: '' } : undefined
    })

    enqueue(media, 2)
    await vi.waitFor(() => expect(get(downloads)['7:2']?.status).toBe('error'))
    const error = get(downloads)['7:2']?.error ?? ''
    expect(error).toContain('Settings › Playback')
    expect(error).not.toContain('widevine-not-installed')
    expect(storeShakaOffline).not.toHaveBeenCalled()
  })

  it('pauses through the module and a cancel discards the folder', async () => {
    downloads.set({ '7:2': { id: '7:2', mediaId: 7, episode: 2, title: 'x', bytes: 10, downloaded: 4, status: 'downloading', addedAt: 1, kind: 'drm-local', path: '/downloads/x.protected' } })
    await pauseDownload('7:2')
    expect(calls('widevine_save_cancel')[0]?.[1]).toEqual({ id: '7:2' })
    expect(calls('download_delete')).toHaveLength(0)
    await cancelDownload('7:2')
    expect(calls('download_delete')[0]?.[1]).toEqual({ path: '/downloads/x.protected' })
  })

  it('keeps the webview path where the module does not play protected video', async () => {
    resolveDownloadUrl.mockResolvedValue(shaka)
    storeShakaOffline.mockResolvedValue({ offlineUri: 'offline:1', drmKeySystem: 'com.widevine.alpha', persistentLicense: false, bytes: 5 })
    enqueue(media, 2)
    await vi.waitFor(() => expect(get(downloads)['7:2']?.status).toBe('done'))
    expect(calls('widevine_save')).toHaveLength(0)
    expect(get(downloads)['7:2']?.kind).toBe('shaka')
  })
})

describe('protected episodes with a decrypt plan: the module first, the bundled device without it', () => {
  const drm = {
    kind: 'drm',
    url: 'http://127.0.0.1:4000/v/1/manifest.mpd?offline=1',
    planUrl: 'http://127.0.0.1:4000/v/1/offline-plan?offline=1',
    licenseUrl: 'http://127.0.0.1:4000/v/1/license',
    releaseUrl: 'http://127.0.0.1:4000/v/1/session',
    drm: { keySystem: 'com.widevine.alpha', licenseUrl: 'http://127.0.0.1:4000/v/1/license', releaseUrl: 'http://127.0.0.1:4000/v/1/session' },
    filename: 'Test Anime - E2.mp4',
    preferredHeight: 720,
    sourceOriginId: 'example.source',
  }

  afterEach(() => { nativeDrm.on = false })

  it('saves through the installed module from the same presentation manifest', async () => {
    nativeDrm.on = true
    resolveDownloadUrl.mockResolvedValue(drm)
    invoke.mockImplementation(async (command: string) => command === 'download_dir_default' ? '/downloads'
      : command === 'widevine_save_folder' ? '/downloads/Test Anime - E2.protected'
      : command === 'widevine_save' ? { path: '/downloads/Test Anime - E2.protected', bytes: 600, height: 720 }
      : command === 'ext_fetch' ? { status: 200, body: '' } : undefined)

    enqueue(media, 2)
    await vi.waitFor(() => expect(get(downloads)['7:2']?.status).toBe('done'))

    expect(calls('widevine_save')[0]?.[1]).toMatchObject({ manifestUrl: drm.url, maxHeight: 720, drm: drm.drm })
    expect(calls('drm_download_start')).toHaveLength(0)
    expect(get(downloads)['7:2']).toMatchObject({ kind: 'drm-local', requiresOnlineLicense: false })
  })

  it('falls back to the bundled device when the module is not installed', async () => {
    nativeDrm.on = true
    resolveDownloadUrl.mockResolvedValue(drm)
    invoke.mockImplementation(async (command: string) => {
      if (command === 'widevine_save') throw new Error('widevine-not-installed')
      return command === 'download_dir_default' ? '/downloads'
        : command === 'widevine_save_folder' ? '/downloads/Test Anime - E2.protected'
        : command === 'ext_fetch' ? { status: 200, body: '' } : undefined
    })

    enqueue(media, 2)
    await vi.waitFor(() => expect(calls('drm_download_start')).toHaveLength(1))

    expect(calls('drm_download_start')[0]?.[1]).toMatchObject({
      id: '7:2', planUrl: drm.planUrl, licenseUrl: drm.licenseUrl, releaseUrl: drm.releaseUrl, dir: '/downloads', filename: drm.filename,
    })
    // Pause and cancel now route to the device engine, and no module folder is left recorded.
    expect(get(downloads)['7:2']).toMatchObject({ kind: 'drm', path: undefined })
    expect(get(downloads)['7:2']?.status).not.toBe('error')
  })

  it('does not hide other module failures behind the fallback', async () => {
    nativeDrm.on = true
    resolveDownloadUrl.mockResolvedValue(drm)
    invoke.mockImplementation(async (command: string) => {
      if (command === 'widevine_save') throw new Error('the licence server refused this device (HTTP 403)')
      return command === 'download_dir_default' ? '/downloads' : command === 'widevine_save_folder' ? '/downloads/x.protected' : undefined
    })

    enqueue(media, 2)
    await vi.waitFor(() => expect(get(downloads)['7:2']?.status).toBe('error'))
    expect(calls('drm_download_start')).toHaveLength(0)
  })

  it('uses the bundled device directly where the module is not built', async () => {
    resolveDownloadUrl.mockResolvedValue(drm)
    enqueue(media, 2)
    await vi.waitFor(() => expect(calls('drm_download_start')).toHaveLength(1))
    expect(calls('widevine_save')).toHaveLength(0)
    expect(get(downloads)['7:2']?.kind).toBe('drm')
  })
})