import { afterEach, describe, expect, it, vi } from 'vitest'
import { get, readable, writable } from 'svelte/store'

const picker = writable<Record<string, unknown> | null>(null)
const connecting = writable<Record<string, unknown> | null>(null)
const rememberedSources = writable<Record<number, unknown>>({})
const hasConfiguredExtensions = vi.fn(async () => true)
const runningExtensionCount = vi.fn(async () => 1)
const resolveOnlineStreams = vi.fn((..._args: unknown[]): Promise<unknown[]> => new Promise(() => {}))
const automaticSources = writable(true)

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
  resolveOnlineStreams: (...args: unknown[]) => resolveOnlineStreams(...args),
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
  banner: () => undefined,
  cover: () => undefined,
  airedCount: () => 12,
  totalEpisodes: () => 12,
}))
vi.mock('$lib/platform', () => ({ isAndroid: readable(false) }))
vi.mock('$lib/stores/offline', () => ({ offlineMode: readable(false) }))
vi.mock('$lib/settings/ui', () => ({
  preferredAudioLang: readable('jpn'),
  preferredSubLang: readable('eng'),
  autoSelectSource: automaticSources,
  autoSelectCountdown: readable(false),
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
  sourcePriority: readable([]),
  sourcePriorityMode: readable('prefer'),
  seadexAnnotations: readable(false),
}))
vi.mock('$lib/player/session', () => ({
  streamPicker: picker,
  connecting,
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
vi.mock('$lib/player/source-origin', () => ({
  sourceOrigins: rememberedSources,
  rememberSourceOrigin: vi.fn(),
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
  connecting.set(null)
  rememberedSources.set({})
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

  it('marks Change source as manual even when automatic selection is enabled', async () => {
    const resolving = playEpisode(media as never, 2, () => {}, { forceManual: true })

    await vi.waitFor(() => expect(get(picker)).toMatchObject({
      episode: 2,
      resolving: true,
      manualOnly: true,
      autoplay: true,
    }))

    cancelResolve()
    await resolving
  })

  it('does not let a remembered provider bypass the globally ranked automatic choice', async () => {
    resolveOnlineStreams.mockResolvedValue([])
    rememberedSources.set({
      1: { origin: { kind: 'online-extension', id: 'last-working-source' }, updatedAt: Date.now() },
    })

    await playEpisode(media as never, 2, () => {})

    expect(resolveOnlineStreams).toHaveBeenCalled()
    expect(resolveOnlineStreams.mock.calls.every((call) => call[2] === undefined)).toBe(true)
    expect(get(picker)).toMatchObject({ hidden: false })
    expect(get(connecting)).toBeNull()
  })
})
