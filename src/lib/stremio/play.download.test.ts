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
  enabledAddonUrls: readable<string[]>(['https://addon.test']),
  addonOriginId: () => 'addon',
}))
vi.mock('./idmap', () => ({ getIndex: async () => ({}), lookupKitsu: () => undefined }))
vi.mock('./kitsu', () => ({ kitsuIdFromMal: async () => undefined }))
vi.mock('./onlinestream', () => ({ resolveOnlineStreams: () => new Promise<never>(() => {}) }))
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
vi.mock('$lib/downloads/state', () => ({ downloadOf: () => undefined }))
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
  fetchMediaById: async () => media,
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
  vi.clearAllMocks()
})

describe('resolveDownloadUrl source preference', () => {
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
