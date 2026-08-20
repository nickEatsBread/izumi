import { afterEach, describe, expect, it, vi } from 'vitest'
import { get, readable, writable } from 'svelte/store'

const picker = writable<Record<string, unknown> | null>(null)
const connecting = writable<Record<string, unknown> | null>(null)
const rememberedSources = writable<Record<number, unknown>>({})
const rememberedEpisodeSources = writable<Record<string, unknown>>({})
const hasConfiguredExtensions = vi.fn(async () => true)
const runningExtensionCount = vi.fn(async () => 1)
const resolveOnlineStreams = vi.fn((..._args: unknown[]): Promise<unknown[]> => new Promise(() => {}))
const fetchMediaById = vi.fn()
const automaticSources = writable(true)
const continueSourcePreference = writable<'resumed' | 'always' | 'never'>('resumed')
const configuredAddonUrls = writable<string[]>([])

vi.mock('./sources', () => ({
  addonUrls: configuredAddonUrls,
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
  continueSourcePreference,
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
vi.mock('$lib/anilist/fetch-media', () => ({
  fetchMediaById: (...args: unknown[]) => fetchMediaById(...args),
}))
vi.mock('$lib/player/source-origin', () => ({
  sourceOrigins: rememberedSources,
  episodeSourceOrigins: rememberedEpisodeSources,
  rememberSourceOrigin: vi.fn(),
}))

const {
  cancelResolve,
  commitResolveSelection,
  playEpisode,
  REMEMBERED_SOURCE_MAX_AGE_MS,
  REMEMBERED_SOURCE_PRIORITY_MS,
  resumeEpisode,
} = await import('./play')
const { durablePositions } = await import('$lib/player/progress')

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
  rememberedEpisodeSources.set({})
  durablePositions.set({})
  continueSourcePreference.set('resumed')
  configuredAddonUrls.set([])
  fetchMediaById.mockReset()
  vi.clearAllMocks()
  hasConfiguredExtensions.mockResolvedValue(true)
})

describe('manual episode source chooser', () => {
  it('reports disabled add-ons instead of claiming that the episode has no streams', async () => {
    configuredAddonUrls.set(['https://disabled-addon.test'])
    hasConfiguredExtensions.mockResolvedValue(false)

    await playEpisode(media as never, 2, () => {})

    expect(get(picker)).toMatchObject({
      resolving: false,
      playbackError: 'All configured stream add-ons are disabled — enable one in Settings → Sources.',
    })
  })

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

describe('Continue Watching source resolution', () => {
  it('settles the card spinner when source selection takes over playback', async () => {
    fetchMediaById.mockResolvedValue(media)
    let finishDiscovery!: (streams: unknown[]) => void
    resolveOnlineStreams.mockImplementation(() => new Promise((resolve) => { finishDiscovery = resolve }))
    const states: string[] = []
    const resolving = resumeEpisode(media as never, 2, (state) => states.push(state.status))

    await vi.waitFor(() => expect(get(picker)).toMatchObject({ episode: 2, resolving: true }))
    commitResolveSelection()
    finishDiscovery([])
    await resolving

    expect(states.at(-1)).toBe('idle')
  })

  it('starts the progressive picker instead of blocking on a pinned remembered provider', async () => {
    continueSourcePreference.set('always')
    fetchMediaById.mockResolvedValue(media)
    resolveOnlineStreams.mockImplementation(() => new Promise(() => {}))
    rememberedSources.set({
      1: { origin: { kind: 'online-extension', id: 'remembered-provider' }, updatedAt: Date.now() },
    })

    const resolving = resumeEpisode(media as never, 2, () => {})

    await vi.waitFor(() => expect(get(picker)).toMatchObject({
      episode: 2,
      resolving: true,
      hidden: true,
      continuationPending: true,
    }))
    expect(resolveOnlineStreams).toHaveBeenCalled()
    expect(resolveOnlineStreams.mock.calls.every((call) => call[2] === undefined)).toBe(true)

    cancelResolve()
    await resolving
  })

  it('reveals parallel fallbacks after the remembered-source priority window', async () => {
    vi.useFakeTimers()
    try {
      fetchMediaById.mockResolvedValue(media)
      continueSourcePreference.set('always')
      resolveOnlineStreams.mockImplementation(() => new Promise(() => {}))
      rememberedSources.set({
        1: { origin: { kind: 'online-extension', id: 'remembered-provider' }, updatedAt: Date.now() },
      })

      const resolving = resumeEpisode(media as never, 2, () => {})
      await vi.advanceTimersByTimeAsync(0)
      expect(get(picker)).toMatchObject({ hidden: true, continuationPending: true })

      await vi.advanceTimersByTimeAsync(REMEMBERED_SOURCE_PRIORITY_MS)
      expect(get(picker)).toMatchObject({ hidden: false, continuationPending: false })

      cancelResolve()
      await resolving
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not prioritize a source remembered 30 days ago', async () => {
    fetchMediaById.mockResolvedValue(media)
    continueSourcePreference.set('always')
    resolveOnlineStreams.mockImplementation(() => new Promise(() => {}))
    rememberedSources.set({
      1: {
        origin: { kind: 'online-extension', id: 'stale-provider' },
        updatedAt: Date.now() - REMEMBERED_SOURCE_MAX_AGE_MS,
      },
    })

    const resolving = resumeEpisode(media as never, 2, () => {})
    await vi.waitFor(() => expect(get(picker)).toMatchObject({
      episode: 2,
      resolving: true,
      hidden: false,
    }))
    expect(get(picker)).not.toMatchObject({ continuationPending: true })

    cancelResolve()
    await resolving
  })

  it('defaults to the exact source of an episode with saved progress', async () => {
    fetchMediaById.mockResolvedValue(media)
    resolveOnlineStreams.mockImplementation(() => new Promise(() => {}))
    durablePositions.set({ '1:2': { pos: 300, dur: 1400, updatedAt: Date.now() } })
    rememberedEpisodeSources.set({
      '1:2': {
        origin: { kind: 'online-extension', id: 'episode-source' },
        updatedAt: Date.now(),
      },
    })

    const resolving = resumeEpisode(media as never, 2, () => {})
    await vi.waitFor(() => expect(get(picker)).toMatchObject({
      hidden: true,
      continuationPending: true,
    }))

    cancelResolve()
    await resolving
  })

  it('uses normal ranking for an unwatched episode by default', async () => {
    fetchMediaById.mockResolvedValue(media)
    resolveOnlineStreams.mockImplementation(() => new Promise(() => {}))
    rememberedSources.set({
      1: { origin: { kind: 'online-extension', id: 'title-source' }, updatedAt: Date.now() },
    })
    rememberedEpisodeSources.set({
      '1:2': { origin: { kind: 'online-extension', id: 'episode-source' }, updatedAt: Date.now() },
    })

    const resolving = resumeEpisode(media as never, 2, () => {})
    await vi.waitFor(() => expect(get(picker)).toMatchObject({ hidden: false }))
    expect(get(picker)).not.toMatchObject({ continuationPending: true })

    cancelResolve()
    await resolving
  })

  it('can disable source preference even for a resumed episode', async () => {
    continueSourcePreference.set('never')
    fetchMediaById.mockResolvedValue(media)
    resolveOnlineStreams.mockImplementation(() => new Promise(() => {}))
    durablePositions.set({ '1:2': { pos: 300, dur: 1400, updatedAt: Date.now() } })
    rememberedEpisodeSources.set({
      '1:2': { origin: { kind: 'online-extension', id: 'episode-source' }, updatedAt: Date.now() },
    })

    const resolving = resumeEpisode(media as never, 2, () => {})
    await vi.waitFor(() => expect(get(picker)).toMatchObject({ hidden: false }))

    cancelResolve()
    await resolving
  })
})
