import { beforeEach, describe, it, expect, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  phttp: vi.fn(),
  getExtensionIds: vi.fn(),
  getKitsuId: vi.fn(),
  fetchManifest: vi.fn(),
  getIndex: vi.fn(),
  lookupKitsu: vi.fn(),
  kitsuIdFromMal: vi.fn(),
  osSearch: vi.fn(),
  subdlSearch: vi.fn(),
}))

vi.mock('$lib/net/http', () => ({ phttp: mocks.phttp }))
vi.mock('$lib/anizip', () => ({ getExtensionIds: mocks.getExtensionIds, getKitsuId: mocks.getKitsuId }))
vi.mock('./manifest', () => ({ fetchManifest: mocks.fetchManifest }))
vi.mock('./idmap', () => ({ getIndex: mocks.getIndex, lookupKitsu: mocks.lookupKitsu }))
vi.mock('./kitsu', () => ({ kitsuIdFromMal: mocks.kitsuIdFromMal }))
vi.mock('./subtitles/opensubtitles', () => ({
  createOpenSubtitles: () => ({ id: 'opensubtitles', search: mocks.osSearch }),
  OPEN_SUBS_API_KEY: 'TEST_KEY',
}))
vi.mock('./subtitles/subdl', () => ({ createSubDL: () => ({ id: 'subdl', search: mocks.subdlSearch }) }))

import { fetchExternalSubtitles, mergeCandidates } from './subtitles'
import { subtitleProviders, subDlApiKey, preferredSubLang } from '$lib/settings/ui'
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
    subtitleProviders.set(['opensubtitles', 'subdl'])
    subDlApiKey.set('SUBDL_KEY')
    preferredSubLang.set('eng')
    mocks.getExtensionIds.mockResolvedValue({ imdbId: 'tt0000123', season: 1 })
    mocks.getKitsuId.mockResolvedValue(undefined)
    mocks.getIndex.mockRejectedValue(new Error('no index')) // kitsuIdOf → undefined
    mocks.fetchManifest.mockResolvedValue({ resources: ['subtitles'], idPrefixes: ['tt'] })
    mocks.phttp.mockResolvedValue({ ok: true, status: 200, text: async () => '', json: async () => ({ subtitles: [{ url: 'https://addon/s.srt', lang: 'en', id: 'a1' }] }) })
    mocks.osSearch.mockResolvedValue([{ provider: 'opensubtitles', lang: 'en', release: 'R', download: { needsFetch: true, fileId: 42 } }])
    mocks.subdlSearch.mockResolvedValue([{ provider: 'subdl', lang: 'EN', release: 'Z', download: { needsFetch: true, zipUrl: 'https://dl.subdl.com/z.zip' } }])
  })

  it('fans out to the addon + enabled external providers and flattens the results', async () => {
    const out = await fetchExternalSubtitles(['https://addon'], MEDIA, 5, 'Show.S01E05.mkv')
    expect(out).toContainEqual({ provider: 'addon', url: 'https://addon/s.srt', lang: 'en', id: 'a1' })
    expect(out).toContainEqual({ provider: 'opensubtitles', lang: 'en', release: 'R', download: { needsFetch: true, fileId: 42 } })
    expect(out).toContainEqual({ provider: 'subdl', lang: 'EN', release: 'Z', download: { needsFetch: true, zipUrl: 'https://dl.subdl.com/z.zip' } })
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
})
