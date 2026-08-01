import { afterEach, describe, expect, it, vi } from 'vitest'
import { get, readable, writable } from 'svelte/store'

// Autoplay readiness must not wait for every source to settle. This pins the case that used to
// be unreachable: one addon answers instantly with a cached row while an extension provider hangs
// forever, so `resolving` never flips false and the countdown never started at all.

const picker = writable<Record<string, unknown> | null>(null)
const phttp = vi.fn()

vi.mock('$lib/net/http', () => ({ phttp: (...a: unknown[]) => phttp(...a) }))
vi.mock('./manifest', async (actual) => ({ ...(await actual() as object), fetchManifest: async () => ({ id: 'a', name: 'Addon', version: '1' }) }))
vi.mock('./sources', () => ({
  enabledAddonUrls: readable<string[]>(['https://addon.test']),
  addonOriginId: () => 'addon',
}))
vi.mock('./idmap', () => ({ getIndex: async () => ({}), lookupKitsu: () => undefined }))
vi.mock('./kitsu', () => ({ kitsuIdFromMal: async () => undefined }))
vi.mock('./onlinestream', () => ({ resolveOnlineStreams: () => new Promise<never>(() => {}) }))
vi.mock('$lib/anizip', () => ({
  getKitsuId: async () => 42,
  getEpisodeSeasonMap: async () => ({}),
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
  cover: () => undefined,
  airedCount: () => 12,
  totalEpisodes: () => 12,
}))
vi.mock('$lib/platform', () => ({ isAndroid: readable(false) }))
vi.mock('$lib/stores/offline', () => ({ offlineMode: readable(false) }))
vi.mock('$lib/settings/ui', () => ({
  preferredAudioLang: readable('jpn'),
  preferredSubLang: readable('eng'),
  autoSelectSource: readable(false),
  preferredQuality: readable('any'),
  skipFiller: readable(false),
  seadexAnnotations: readable(true),
  autoplayNext: readable(false),
  enableExternalPlayer: readable(false),
  externalPlayerPath: readable(''),
  debridKey: readable(''),
  debridProvider: readable('realdebrid'),
  bingePreload: readable(false),
  playerCacheMb: readable(64),
  playerCacheBytes: readable(0),
  torrentPlaybackMode: readable('direct'),
  torrentDownloadLimitMbps: readable(0),
  torrentUploadLimitMode: readable('automatic'),
  torrentUpstreamCapacityMbps: readable(0),
}))
vi.mock('$lib/player/session', () => ({
  streamPicker: picker,
  connecting: writable(null),
  playing: writable(false),
  playerLoadId: writable(0),
  nowPlaying: writable({}),
  nowPlayingUrl: writable(''),
  playerNotice: writable(''),
  spriteKey: writable(''),
  bingeSource: writable(null),
  nowPlayingMedia: writable(null),
  nowPlayingPartySource: writable({ source: null, error: '' }),
  debridCaching: writable(null),
  onlineSubCandidates: writable([]),
  subtitleNotice: writable(''),
  torrentSubtitleState: writable({ status: 'idle', tracks: [] }),
  playbackRecovery: writable(null),
}))

const { cancelResolve, playEpisode } = await import('./play')

const media = {
  id: 1,
  idMal: 1,
  title: { romaji: 'Test Anime', english: 'Test Anime' },
  synonyms: [],
  format: 'TV',
  episodes: 12,
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

afterEach(() => {
  cancelResolve()
  picker.set(null)
  vi.clearAllMocks()
})

describe('autoplay readiness', () => {
  it('becomes ready from a held cached pick while a provider is still hanging', async () => {
    phttp.mockResolvedValue({
      ok: true,
      json: async () => ({
        streams: [{ url: 'https://host/ep.mkv', name: '[RD+] Addon', title: '[Group] Test Anime - 02 (1080p) 👤 40' }],
      }),
    })

    const resolving = playEpisode(media as never, 2, () => {})

    await vi.waitFor(() => expect(get(picker)).toMatchObject({ resolving: true }))
    await vi.waitFor(() => expect((get(picker)?.streams as unknown[]).length).toBe(1))
    // The hold has not elapsed yet, and the online provider never settles.
    expect(get(picker)?.autoReady).toBeFalsy()

    await sleep(600)

    expect(get(picker)).toMatchObject({ resolving: true, autoReady: true })

    cancelResolve()
    await resolving
  })

  it('does not become ready while there are no results at all', async () => {
    phttp.mockResolvedValue({ ok: true, json: async () => ({ streams: [] }) })

    const resolving = playEpisode(media as never, 2, () => {})

    await vi.waitFor(() => expect(get(picker)).toMatchObject({ resolving: true }))
    await sleep(600)

    expect(get(picker)?.autoReady).toBeFalsy()

    cancelResolve()
    await resolving
  })
})
