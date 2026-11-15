import { beforeEach, describe, it, expect, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  phttp: vi.fn(),
  getExtensionIds: vi.fn(),
  getKitsuId: vi.fn(),
  fetchManifest: vi.fn(),
  getIndex: vi.fn(),
  lookupKitsu: vi.fn(),
  kitsuIdFromLinks: vi.fn(),
  osSearch: vi.fn(),
  subdlSearch: vi.fn(),
  jimakuSearch: vi.fn(),
}))

vi.mock('$lib/net/http', () => ({ phttp: mocks.phttp }))
vi.mock('$lib/anizip', () => ({ getExtensionIds: mocks.getExtensionIds, getKitsuId: mocks.getKitsuId }))
vi.mock('./manifest', () => ({ fetchManifest: mocks.fetchManifest }))
vi.mock('./idmap', () => ({ getIndex: mocks.getIndex, lookupKitsu: mocks.lookupKitsu }))
vi.mock('./kitsu', () => ({ kitsuIdFromLinks: mocks.kitsuIdFromLinks }))
vi.mock('./subtitles/opensubtitles', () => ({
  createOpenSubtitles: () => ({ id: 'opensubtitles', search: mocks.osSearch }),
  OPEN_SUBS_API_KEY: 'TEST_KEY',
}))
vi.mock('./subtitles/subdl', () => ({ createSubDL: () => ({ id: 'subdl', search: mocks.subdlSearch }) }))
vi.mock('./subtitles/jimaku', () => ({ createJimaku: () => ({ id: 'jimaku', search: mocks.jimakuSearch }) }))

import { fetchExternalSubtitles, mergeCandidates } from './subtitles'
import { subtitleProviders, subDlApiKey, jimakuApiKey, preferredSubLang } from '$lib/settings/ui'
import type { SubtitleCandidate } from './subtitles/types'
import type { Media } from '$lib/anilist/types'

const MEDIA: Media = { id: 1, title: {}, format: 'TV' }

describe('mergeCandidates', () => {
  it('dedupes url-bearing candidates by url', () => {
    const a: SubtitleCandidate = { provider: 'addon', url: 'https://x/s.srt', lang: 'en' }
    const b: SubtitleCandidate = { provider: 'addon', url: 'https://x/s.srt', lang: 'en', id: 'dup' }
    expect(mergeCandidates([[a], [b]])).toEqual([a])
  })
  it('dedupes needsFetch candidates by provider + fileId / zipUrl', () => {
    const os1: SubtitleCandidate = { provider: 'opensubtitles', download: { needsFetch: true, fileId: 5 } }
    const os2: SubtitleCandidate = { provider: 'opensubtitles', download: { needsFetch: true, fileId: 5 } }
    const sd: SubtitleCandidate = { provider: 'subdl', download: { needsFetch: true, zipUrl: 'https://dl/z.zip' } }
    expect(mergeCandidates([[os1], [os2], [sd]])).toEqual([os1, sd])
  })
  it('keeps distinct fileIds', () => {
    const os5: SubtitleCandidate = { provider: 'opensubtitles', download: { needsFetch: true, fileId: 5 } }
    const os6: SubtitleCandidate = { provider: 'opensubtitles', download: { needsFetch: true, fileId: 6 } }
    expect(mergeCandidates([[os5], [os6]])).toEqual([os5, os6])
  })
})

describe('fetchExternalSubtitles', () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset()
    subtitleProviders.set(['opensubtitles', 'subdl', 'jimaku'])
    subDlApiKey.set('SUBDL_KEY')
    jimakuApiKey.set('JIMAKU_KEY')
    preferredSubLang.set('eng')
    mocks.getExtensionIds.mockResolvedValue({ imdbId: 'tt0000123', season: 1, episodeNumber: 5 })
    mocks.getKitsuId.mockResolvedValue(undefined)
    mocks.getIndex.mockRejectedValue(new Error('no index')) // kitsuIdOf → undefined
    mocks.fetchManifest.mockResolvedValue({ resources: ['subtitles'], idPrefixes: ['tt'] })
    mocks.phttp.mockResolvedValue({ ok: true, status: 200, text: async () => '', json: async () => ({ subtitles: [{ url: 'https://addon/s.srt', lang: 'en', id: 'a1' }] }) })
    mocks.osSearch.mockResolvedValue([{ provider: 'opensubtitles', lang: 'en', release: 'R', download: { needsFetch: true, fileId: 42 } }])
    mocks.subdlSearch.mockResolvedValue([{ provider: 'subdl', lang: 'EN', release: 'Z', download: { needsFetch: true, zipUrl: 'https://dl.subdl.com/z.zip' } }])
    mocks.jimakuSearch.mockResolvedValue([{ provider: 'jimaku', lang: 'ja', release: 'Show - 05.srt', download: { needsFetch: true, fileUrl: 'https://jimaku.cc/entry/9/download/s.srt' } }])
  })

  it('fans out to the addon + enabled external providers and flattens the results', async () => {
    const out = await fetchExternalSubtitles(['https://addon'], MEDIA, 5, 'Show.S01E05.mkv')
    expect(out).toContainEqual({ provider: 'addon', url: 'https://addon/s.srt', lang: 'en', id: 'a1' })
    expect(out).toContainEqual({ provider: 'opensubtitles', lang: 'en', release: 'R', download: { needsFetch: true, fileId: 42 } })
    expect(out).toContainEqual({ provider: 'subdl', lang: 'EN', release: 'Z', download: { needsFetch: true, zipUrl: 'https://dl.subdl.com/z.zip' } })
    expect(out).toContainEqual({ provider: 'jimaku', lang: 'ja', release: 'Show - 05.srt', download: { needsFetch: true, fileUrl: 'https://jimaku.cc/entry/9/download/s.srt' } })
  })

  it('builds a SubQuery with the raw tt imdb, season, episode, filename and lowercase languages', async () => {
    await fetchExternalSubtitles(['https://addon'], MEDIA, 5, 'Show.S01E05.mkv')
    expect(mocks.osSearch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'series', imdbId: 'tt0000123', parentImdbId: 'tt0000123', season: 1, episode: 5, filename: 'Show.S01E05.mkv',
    }))
    expect(mocks.osSearch.mock.calls[0][0].languages).toEqual(['en'])
  })

  it('still returns the other providers results when one provider throws', async () => {
    mocks.subdlSearch.mockRejectedValue(new Error('subdl down'))
    const out = await fetchExternalSubtitles(['https://addon'], MEDIA, 5, 'Show.S01E05.mkv')
    expect(out.some((c) => c.provider === 'opensubtitles')).toBe(true)
    expect(out.some((c) => c.provider === 'addon')).toBe(true)
    expect(out.some((c) => c.provider === 'subdl')).toBe(false)
  })

  it('drops SubDL from the fan-out when no api key is set', async () => {
    subDlApiKey.set('')
    await fetchExternalSubtitles(['https://addon'], MEDIA, 5, 'Show.S01E05.mkv')
    expect(mocks.subdlSearch).not.toHaveBeenCalled()
    expect(mocks.osSearch).toHaveBeenCalledOnce()
  })

  it('drops Jimaku from the fan-out when no api key is set', async () => {
    jimakuApiKey.set('')
    await fetchExternalSubtitles(['https://addon'], MEDIA, 5, 'Show.S01E05.mkv')
    expect(mocks.jimakuSearch).not.toHaveBeenCalled()
    expect(mocks.osSearch).toHaveBeenCalledOnce()
  })

  it('passes the AniList id through so Jimaku can resolve its entry', async () => {
    await fetchExternalSubtitles(['https://addon'], MEDIA, 5, 'Show.S01E05.mkv')
    expect(mocks.jimakuSearch).toHaveBeenCalledWith(expect.objectContaining({ anilistId: MEDIA.id, episode: 5 }))
  })
})

describe('add-on subtitle requests use the stream request ids', () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset()
    subtitleProviders.set([])
    mocks.getKitsuId.mockResolvedValue(undefined)
    mocks.getIndex.mockRejectedValue(new Error('no index'))
    mocks.fetchManifest.mockResolvedValue({ resources: ['subtitles'], idPrefixes: ['tt'] })
    mocks.phttp.mockResolvedValue({ ok: true, json: async () => ({ subtitles: [] }) })
  })
  const asked = () => mocks.phttp.mock.calls.map((call) => call[0] as string)

  it('asks with the mapped per-season episode, not the AniList episode', async () => {
    mocks.getExtensionIds.mockResolvedValue({ imdbId: 'tt0000001', season: 2, episodeNumber: 3 })
    await fetchExternalSubtitles(['https://h.test'], MEDIA, 15)
    expect(asked()).toEqual(['https://h.test/subtitles/series/tt0000001%3A2%3A3.json'])
  })

  it('never guesses a triple when the mapping names no per-season episode', async () => {
    mocks.getExtensionIds.mockResolvedValue({ imdbId: 'tt0000001', season: 2 })
    await fetchExternalSubtitles(['https://h.test'], MEDIA, 15)
    expect(asked()).toEqual([])
  })

  it('asks a Stremio catalog item with its own video id and meta type', async () => {
    const media: Media = {
      id: -42, title: {},
      catalog: { provider: 'stremio', id: 'x', type: 'series', resourceType: 'series' },
      videos: [{ id: 'tt0000002:1:4', number: 4, season: 1, episode: 4 }],
    }
    await fetchExternalSubtitles(['https://h.test'], media, 4)
    expect(mocks.getExtensionIds).not.toHaveBeenCalled()
    expect(asked()).toEqual(['https://h.test/subtitles/series/tt0000002%3A1%3A4.json'])
  })

  it('asks a TMDB catalog item with its IMDb id and the video season/episode', async () => {
    const media: Media = {
      id: -7, title: {},
      catalog: { provider: 'tmdb', id: '77', type: 'series' },
      externalIds: { imdb: 'tt0000003' },
      videos: [{ number: 7, season: 2, episode: 1 }],
    }
    await fetchExternalSubtitles(['https://h.test'], media, 7)
    expect(asked()).toEqual(['https://h.test/subtitles/series/tt0000003%3A2%3A1.json'])
  })

  it('sends videoHash, videoSize and filename, and keeps a configuration query last', async () => {
    mocks.getExtensionIds.mockResolvedValue({ imdbId: 'tt0000001', season: 1, episodeNumber: 5 })
    await fetchExternalSubtitles(['https://h.test/addon/manifest.json?token=x'], MEDIA, 5, 'Show.S01E05.mkv', {
      size: 1234567, hash: '0123456789ABCDEF',
    })
    expect(asked()).toEqual([
      'https://h.test/addon/subtitles/series/tt0000001%3A1%3A5/videoHash=0123456789abcdef&videoSize=1234567&filename=Show.S01E05.mkv.json?token=x',
    ])
  })
})
