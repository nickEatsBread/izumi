import { beforeEach, describe, it, expect, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ phttp: vi.fn() }))
vi.mock('$lib/net/http', () => ({ phttp: mocks.phttp }))

import { createOpenSubtitles, osImdb, osSearchParams, OPEN_SUBS_API_KEY } from './opensubtitles'
import type { SubQuery } from './types'

const SERIES: SubQuery = { type: 'series', imdbId: 'tt0211915', parentImdbId: 'tt0211915', season: 8, episode: 5, languages: ['en'] }
const MOVIE: SubQuery = { type: 'movie', imdbId: 'tt0245429', languages: ['en'] }

describe('osImdb (strip tt + leading zeros)', () => {
  it('strips the tt prefix and leading zeros', () => expect(osImdb('tt0211915')).toBe('211915'))
  it('handles an all-but-one-zero id', () => expect(osImdb('tt0000001')).toBe('1'))
  it('is undefined for a missing id', () => expect(osImdb(undefined)).toBeUndefined())
})

describe('osSearchParams', () => {
  it('uses episode form A (parent_imdb_id + season + episode) and never mixes in imdb_id', () => {
    const p = new URLSearchParams(osSearchParams(SERIES))
    expect(p.get('parent_imdb_id')).toBe('211915')
    expect(p.get('season_number')).toBe('8')
    expect(p.get('episode_number')).toBe('5')
    expect(p.get('imdb_id')).toBeNull()
  })
  it('uses imdb_id (no season/episode) for a movie', () => {
    const p = new URLSearchParams(osSearchParams(MOVIE))
    expect(p.get('imdb_id')).toBe('245429')
    expect(p.get('season_number')).toBeNull()
    expect(p.get('parent_imdb_id')).toBeNull()
  })
  it('emits no imdb params for a series whose season/episode are unmapped', () => {
    const p = new URLSearchParams(osSearchParams({ type: 'series', imdbId: 'tt0211915', parentImdbId: 'tt0211915', languages: ['en'] }))
    expect(p.get('imdb_id')).toBeNull()
    expect(p.get('parent_imdb_id')).toBeNull()
  })
  it('lowercases and sorts languages', () => {
    const p = new URLSearchParams(osSearchParams({ ...MOVIE, languages: ['EN', 'ar'] }))
    expect(p.get('languages')).toBe('ar,en')
  })
  it('emits the params in sorted key order', () => {
    expect(osSearchParams(SERIES).startsWith('episode_number=')).toBe(true)
  })
})

describe('createOpenSubtitles().search', () => {
  beforeEach(() => mocks.phttp.mockReset())

  const body = {
    data: [
      { id: 'os1', attributes: { language: 'en', release: 'Show.S08E05.x264-HD', files: [{ file_id: 123456, file_name: 'a.srt' }] } },
      { id: 'os2', attributes: { language: 'en', release: 'no-file', files: [] } },
    ],
  }

  it('maps data[].attributes → candidates with download.fileId', async () => {
    mocks.phttp.mockResolvedValue({ ok: true, status: 200, json: async () => body, text: async () => '' })
    const out = await createOpenSubtitles().search(SERIES)
    expect(out).toEqual([
      { provider: 'opensubtitles', lang: 'en', release: 'Show.S08E05.x264-HD', id: 'os1', download: { needsFetch: true, fileId: 123456 } },
    ])
  })

  it('sends the embedded Api-Key + a non-default User-Agent on every call', async () => {
    mocks.phttp.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }), text: async () => '' })
    await createOpenSubtitles().search(SERIES)
    expect(mocks.phttp).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/subtitles?'),
      { headers: expect.objectContaining({ 'Api-Key': OPEN_SUBS_API_KEY, 'User-Agent': expect.stringContaining('izumi') }) },
    )
  })

  it('returns [] on empty data, a non-2xx response, a throw, or no usable id', async () => {
    mocks.phttp.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }), text: async () => '' })
    expect(await createOpenSubtitles().search(SERIES)).toEqual([])
    mocks.phttp.mockResolvedValue({ ok: false, status: 500, json: async () => ({}), text: async () => '' })
    expect(await createOpenSubtitles().search(SERIES)).toEqual([])
    mocks.phttp.mockRejectedValue(new Error('network'))
    expect(await createOpenSubtitles().search(SERIES)).toEqual([])
    mocks.phttp.mockReset()
    expect(await createOpenSubtitles().search({ type: 'series', languages: ['en'] })).toEqual([])
    expect(mocks.phttp).not.toHaveBeenCalled()
  })
})
