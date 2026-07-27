import { afterEach, describe, expect, it, vi } from 'vitest'
import { get, readable, writable } from 'svelte/store'

const picker = writable<Record<string, unknown> | null>(null)
const hasConfiguredExtensions = vi.fn(async () => true)
const runningExtensionCount = vi.fn(async () => 1)
const resolveOnlineStreams = vi.fn(() => new Promise<never>(() => {}))

vi.mock('./sources', () => ({
  enabledAddonUrls: readable<string[]>([]),
  addonOriginId: () => '',
}))
vi.mock('./idmap', () => ({
  getIndex: async () => ({}),
  lookupKitsu: () => undefined,
}))
vi.mock('./kitsu', () => ({ kitsuIdFromMal: async () => undefined }))
vi.mock('./onlinestream', () => ({
  resolveOnlineStreams: () => resolveOnlineStreams(),
}))
vi.mock('$lib/anizip', () => ({
  getKitsuId: async () => undefined,
  getEpisodeSeasonMap: async () => ({}),
  getExtensionIds: async () => ({}),
}))
vi.mock('$lib/downloads/state', () => ({ downloadOf: () => undefined }))
vi.mock('$lib/extensions/manager', () => ({
  hasConfiguredExtensions: () => hasConfiguredExtensions(),
  queryExtensions: async () => [],
  // Kept in the mock as a regression tripwire: provider cardinality must never hide a chooser.
  runningExtensionCount: () => runningExtensionCount(),
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
  preferredQuality: readable('1080p'),
  skipFiller: readable(false),
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

afterEach(() => {
  cancelResolve()
  picker.set(null)
  vi.clearAllMocks()
})

describe('manual episode source chooser', () => {
  it('stays visible while a single provider resolves its multiple server choices', async () => {
    const resolving = playEpisode(media as never, 2, () => {})

    await vi.waitFor(() => expect(hasConfiguredExtensions).toHaveBeenCalledOnce())
    await Promise.resolve()

    expect(runningExtensionCount).not.toHaveBeenCalled()
    expect(get(picker)).toMatchObject({
      episode: 2,
      resolving: true,
      hidden: false,
    })

    cancelResolve()
    await resolving
  })
})
