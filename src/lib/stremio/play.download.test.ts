import { afterEach, describe, expect, it, vi } from 'vitest'
import { readable, writable } from 'svelte/store'

// Downloading an episode must honour the SAME torrent-source preference playback does. With
// "Direct P2P" selected (or simply no debrid credential configured) a torrent-only source has to
// reach the local P2P engine — asking for a debrid key there is both wrong and unactionable.

const phttp = vi.fn()
const resolveHash = vi.fn(async (..._a: unknown[]) => 'https://debrid.example/resolved.mkv')
const torrentPlaybackMode = writable<'debrid' | 'direct'>('direct')
const debridKey = writable('')

vi.mock('$lib/net/http', () => ({ phttp: (...a: unknown[]) => phttp(...a) }))
vi.mock('./manifest', async (actual) => ({
  ...(await actual() as object),
  fetchManifest: async () => ({ id: 'a', name: 'Addon', version: '1' }),
}))
vi.mock('./sources', () => ({
  addonUrls: readable<string[]>(['https://addon.test']),
  enabledAddonUrls: readable<string[]>(['https://addon.test']),
  addonOriginId: () => 'addon',
}))
vi.mock('./idmap', () => ({ getIndex: async () => ({}), lookupKitsu: () => undefined }))
vi.mock('./kitsu', () => ({ kitsuIdFromMal: async () => undefined }))
// Resolves empty (not pending): resolveDownloadUrl now awaits the online wave (with a budget),
// so a never-settling mock would stall every test to its own timeout.
const resolveOnlineStreams = vi.fn(async (): Promise<unknown[]> => [])
const getDownloadedMedia = vi.fn()
const fetchMediaById = vi.fn(async () => media)
vi.mock('./onlinestream', () => ({ resolveOnlineStreams: (...a: unknown[]) => resolveOnlineStreams(...a) }))
vi.mock('./debrid', () => ({
  resolveHash: (...a: unknown[]) => resolveHash(...a),
  resolveSidecars: async () => [],
  providerName: (id: string) => (id === 'realdebrid' ? 'Real-Debrid' : id),
  cacheCheckMode: () => 'library',
  checkCached: async () => new Map(),
}))
vi.mock('$lib/anizip', () => ({
  getKitsuId: async () => 42,
  getEpisodeSeasonMap: async () => ({ 2: { season: 1, abs: 2 } }),
  getExtensionIds: async () => ({}),
}))
vi.mock('$lib/downloads/state', () => ({ downloadOf: () => undefined, getDownloadedMedia }))
vi.mock('$lib/extensions/manager', () => ({
  hasConfiguredExtensions: async () => true,
  queryExtensions: async () => [],
  runningExtensionCount: async () => 1,
}))
vi.mock('$lib/extensions/torrentProvider', () => ({
  queryTorrentProviders: async () => [],
  toProviderMedia: (media: unknown) => media,
}))
vi.mock('$lib/anilist/media', () => ({
  title: (media: { title: { romaji: string } }) => media.title.romaji,
  banner: () => undefined,
  cover: () => undefined,
  airedCount: () => 12,
  totalEpisodes: () => 12,
}))
vi.mock('$lib/anilist/fetch-media', () => ({
  fetchMediaById,
  fetchMediaByIds: async () => new Map(),
}))
vi.mock('$lib/platform', () => ({ isAndroid: readable(false) }))
vi.mock('$lib/stores/offline', () => ({ offlineMode: readable(false) }))
vi.mock('$lib/settings/ui', () => ({
  preferredAudioLang: readable('jpn'),
  preferredSubLang: readable('eng'),
  autoSelectSource: readable(false),
  autoSelectCountdown: readable(false),
  preferredQuality: readable('any'),
  skipFiller: readable(false),
  seadexAnnotations: readable(false),
  autoplayNext: readable(false),
  enableExternalPlayer: readable(false),
  externalPlayerPath: readable(''),
  debridKey,
  debridProvider: readable('realdebrid'),
  bingePreload: readable(false),
  playerCacheMb: readable(64),
  playerCacheBytes: readable(0),
  torrentPlaybackMode,
  torrentDownloadLimitMbps: readable(0),
  torrentUploadLimitMode: readable('automatic'),
  torrentUpstreamCapacityMbps: readable(0),
  torrentProxyEnabled: readable(false),
  torrentProxyUrl: readable(''),
  sourcePriority: readable([]),
  sourcePriorityMode: readable('prefer'),
  promoteToWatching: readable(false),
}))
vi.mock('$lib/player/session', () => ({
  streamPicker: writable(null),
  connecting: writable(null),
  nextEpisodeReady: writable(false),
  playing: writable(false),
  playerLoadId: writable(0),
  nowPlaying: writable({}),
  nowPlayingUrl: writable(''),
  nowPlayingStream: writable(null),
  playerNotice: writable(''),
  spriteKey: writable(''),
  bingeSource: writable(null),
  nowPlayingMedia: writable(null),
  nowPlayingPartySource: writable({ source: null, error: '' }),
  debridCaching: writable(null),
  onlineSubCandidates: writable([]),
  subtitleNotice: writable(''),
  torrentSubtitleState: writable({ status: 'idle', tracks: [] }),
  playerSleep: writable(null),
  playbackRecovery: writable(null),
}))

const { resolveDownloadUrl } = await import('./play')

const media = {
  id: 1,
  idMal: 1,
  title: { romaji: 'Test Anime', english: 'Test Anime' },
  synonyms: [],
  format: 'TV',
  episodes: 12,
}

const HASH = 'aabbccddeeff00112233445566778899aabbccdd'
const torrentRow = {
  infoHash: HASH,
  name: 'Addon',
  title: '[Group] Test Anime - 02 (1080p) 👤 40',
  behaviorHints: { filename: 'Test Anime - 02 [1080p].mkv' },
}

const answer = (streams: unknown[]) =>
  phttp.mockResolvedValue({ ok: true, json: async () => ({ streams }) })

afterEach(() => {
  torrentPlaybackMode.set('direct')
  debridKey.set('')
  resolveOnlineStreams.mockReset()
  resolveOnlineStreams.mockResolvedValue([])
  getDownloadedMedia.mockReset()
  fetchMediaById.mockReset()
  fetchMediaById.mockResolvedValue(media)
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('resolveDownloadUrl source preference', () => {
  it('uses the saved series snapshot when AniList is unavailable', async () => {
    getDownloadedMedia.mockReturnValue(media)
    fetchMediaById.mockRejectedValue(new Error('upstream unavailable'))
    answer([torrentRow])

    const resolved = await resolveDownloadUrl(1, 2)

    expect(resolved.kind).toBe('torrent')
    expect(fetchMediaById).not.toHaveBeenCalled()
  })

  it('downloads a torrent-only source through the P2P engine when Direct P2P is selected', async () => {
    answer([torrentRow])

    const resolved = await resolveDownloadUrl(1, 2)

    expect(resolved.kind).toBe('torrent')
    expect(resolved).toMatchObject({ infoHash: HASH })
    expect(resolveHash).not.toHaveBeenCalled()
  })

  it('downloads through the P2P engine when no debrid credential is configured at all', async () => {
    torrentPlaybackMode.set('debrid')
    answer([torrentRow])

    const resolved = await resolveDownloadUrl(1, 2)

    expect(resolved.kind).toBe('torrent')
    expect(resolveHash).not.toHaveBeenCalled()
  })

  it('carries the magnet and episode selection the native engine needs', async () => {
    answer([{ ...torrentRow, sources: [`dht:${HASH}`] }])

    const resolved = await resolveDownloadUrl(1, 2)

    if (resolved.kind !== 'torrent') throw new Error('expected a torrent download')
    expect(resolved.magnet.toLowerCase()).toContain(`urn:btih:${HASH}`)
    expect(resolved.episode).toBe(2)
    expect(resolved.season).toBe(1)
    expect(resolved.absoluteEpisode).toBe(2)
    expect(resolved.preferredFilename).toBe('Test Anime - 02 [1080p].mkv')
  })

  it('still uses debrid when it is the selected mode and a key exists', async () => {
    torrentPlaybackMode.set('debrid')
    debridKey.set('a-key')
    answer([torrentRow])

    const resolved = await resolveDownloadUrl(1, 2)

    expect(resolved.kind).toBe('http')
    expect(resolved).toMatchObject({ url: 'https://debrid.example/resolved.mkv', provider: 'Real-Debrid' })
    expect(resolveHash).toHaveBeenCalledOnce()
  })

  it('takes a plain http source directly without touching either engine', async () => {
    answer([{ url: 'https://host/ep.mkv', name: 'Addon', title: '[Group] Test Anime - 02 (1080p) 👤 40' }])

    const resolved = await resolveDownloadUrl(1, 2)

    expect(resolved).toMatchObject({ kind: 'http', url: 'https://host/ep.mkv' })
    expect(resolveHash).not.toHaveBeenCalled()
  })

  it('routes JVM HLS wrappers through segment assembly instead of saving the playlist', async () => {
    answer([])
    resolveOnlineStreams.mockResolvedValueOnce([{
      url: 'http://localhost:39123/m3u8?url=https%3A%2F%2Fcdn.example%2Fepisode.m3u8',
      name: '⚡ JVM Source · 720p',
      behaviorHints: { filename: 'Test Anime — Episode 2' },
      __stream: true,
      __manifest: 'hls',
      __headers: { Referer: 'https://provider.example/' },
      __origin: { kind: 'online-extension', id: 'jvm:source', name: 'JVM Source' },
    }])

    const resolved = await resolveDownloadUrl(1, 2, { quality: '720' })

    expect(resolved).toMatchObject({
      kind: 'http',
      hls: true,
      preferredHeight: 720,
      filename: 'Test Anime — Episode 2.ts',
      headers: { Referer: 'https://provider.example/' },
    })
  })

  it('routes encrypted DASH to Shaka offline instead of saving the MPD as a file', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    answer([])
    resolveOnlineStreams.mockResolvedValueOnce([{
      url: 'http://127.0.0.1:17902/v/abc/manifest.mpd',
      name: 'Source',
      title: 'Source 480p',
      __drm: { keySystem: 'com.widevine.alpha', licenseUrl: 'http://127.0.0.1:17902/v/abc/license' },
      __origin: { kind: 'online-extension', id: 'source.izumi', name: 'Source' },
    }])

    const resolved = await resolveDownloadUrl(1, 2, { quality: '480' })

    expect(resolved).toMatchObject({
      kind: 'shaka',
      preferredHeight: 480,
      sourceOriginId: 'source.izumi',
    })
    expect(resolved.kind === 'shaka' && resolved.url).toContain('offline=1')
    expect(resolved.kind === 'shaka' && resolved.url).toContain('height=480')
    expect(resolveHash).not.toHaveBeenCalled()
  })

  it('stores the preferred subtitle sidecar for an encrypted source', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    const english = {
      url: 'http://127.0.0.1:17902/v/abc/asset?u=en.ass',
      lang: 'en-US',
      kind: 'subtitles' as const,
    }
    answer([])
    resolveOnlineStreams.mockResolvedValueOnce([{
      url: 'http://127.0.0.1:17902/v/abc/manifest.mpd',
      name: 'Source',
      __audio: 'sub',
      __audioLang: 'ja-JP',
      __drm: { keySystem: 'com.widevine.alpha', licenseUrl: 'http://127.0.0.1:17902/v/abc/license' },
      __subtitles: [
        english,
        { url: 'http://127.0.0.1:17902/v/abc/asset?u=de.ass', lang: 'de-DE', kind: 'subtitles' },
      ],
      __origin: { kind: 'online-extension', id: 'source.izumi', name: 'Source' },
    }])

    const resolved = await resolveDownloadUrl(1, 2, { quality: '480', audio: 'sub' })

    expect(resolved).toMatchObject({
      kind: 'shaka',
      audioLang: 'ja-JP',
      preferredSubLang: 'eng',
      subtitles: [english],
    })
  })

  it('switches an encrypted download onto the preferred dub manifest', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        audioLang: 'ja-JP',
        audioTracks: [
          { language: 'ja-JP', switchUrl: 'http://127.0.0.1:17902/v/abc/manifest.mpd?audio=ja-JP' },
          { language: 'en-US', switchUrl: 'http://127.0.0.1:17902/v/abc/manifest.mpd?audio=en-US' },
        ],
        subtitles: [],
      }),
    })))
    answer([])
    resolveOnlineStreams.mockResolvedValueOnce([{
      url: 'http://127.0.0.1:17902/v/abc/manifest.mpd',
      name: 'Source',
      __audio: 'sub',
      __drm: {
        keySystem: 'com.widevine.alpha',
        licenseUrl: 'http://127.0.0.1:17902/v/abc/license',
        refreshUrl: 'http://127.0.0.1:17902/v/abc/source',
      },
      __origin: { kind: 'online-extension', id: 'source.izumi', name: 'Source' },
    }])

    const resolved = await resolveDownloadUrl(1, 2, { quality: '480', audio: 'dub' })

    expect(resolved).toMatchObject({
      kind: 'shaka',
      audioLang: 'en-US',
    })
    expect(resolved.kind === 'shaka' && resolved.url).toContain('audio=en-US')
    expect(resolved.kind === 'shaka' && resolved.url).toContain('offline=1')
  })
})

describe('resolveDownloadUrl failure copy', () => {
  it('never blames a missing debrid key while Direct P2P is the effective mode', async () => {
    // A row with neither a link nor an infohash cannot be downloaded by ANY engine. The reason it
    // fails is the source, not a credential — asking a P2P user for a debrid key is a dead end.
    answer([{ name: 'Addon', title: '[Group] Test Anime - 02 (1080p) 👤 40', behaviorHints: { filename: 'x.mkv' } }])

    await expect(resolveDownloadUrl(1, 2)).rejects.toThrow(/no downloadable link|no source found/i)
    await expect(resolveDownloadUrl(1, 2)).rejects.not.toThrow(/debrid|key/i)
  })
})
