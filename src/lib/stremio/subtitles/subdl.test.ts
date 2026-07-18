import { beforeEach, describe, it, expect, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ phttp: vi.fn() }))
vi.mock('$lib/net/http', () => ({ phttp: mocks.phttp }))

import { createSubDL, subdlParams } from './subdl'
import { subDlApiKey } from '$lib/settings/ui'
import type { SubQuery } from './types'

const SERIES: SubQuery = { type: 'series', imdbId: 'tt0211915', season: 8, episode: 5, languages: ['en'] }

describe('subdlParams', () => {
  it('carries the api_key, imdb_id, season/episode, uppercase languages and subs_per_page', () => {
    const p = new URLSearchParams(subdlParams(SERIES, 'KEY'))
    expect(p.get('api_key')).toBe('KEY')
    expect(p.get('imdb_id')).toBe('tt0211915')
    expect(p.get('season_number')).toBe('8')
    expect(p.get('episode_number')).toBe('5')
    expect(p.get('languages')).toBe('EN')
    expect(p.get('subs_per_page')).toBe('30')
  })
  it('falls back to tmdb_id + type when there is no imdb id', () => {
    const p = new URLSearchParams(subdlParams({ type: 'movie', tmdbId: '550', languages: ['en'] }, 'KEY'))
    expect(p.get('tmdb_id')).toBe('550')
    expect(p.get('type')).toBe('movie')
    expect(p.get('imdb_id')).toBeNull()
  })
})

describe('createSubDL().search', () => {
  beforeEach(() => { mocks.phttp.mockReset(); subDlApiKey.set('SUBDL_KEY') })

  it('maps subtitles[] → candidates with an absolute dl.subdl.com zipUrl', async () => {
    mocks.phttp.mockResolvedValue({
      ok: true, status: 200, text: async () => '',
      json: async () => ({ status: true, subtitles: [{ release_name: '…SECTOR7', language: 'EN', lang: 'english', url: '/subtitle/3197651-3213944.zip' }] }),
    })
    const out = await createSubDL().search(SERIES)
    expect(out).toEqual([
      { provider: 'subdl', lang: 'EN', release: '…SECTOR7', download: { needsFetch: true, zipUrl: 'https://dl.subdl.com/subtitle/3197651-3213944.zip' } },
    ])
  })

  it('returns [] on an error envelope ({status:false})', async () => {
    mocks.phttp.mockResolvedValue({ ok: true, status: 200, text: async () => '', json: async () => ({ status: false, error: 'nope' }) })
    expect(await createSubDL().search(SERIES)).toEqual([])
  })

  it('returns [] without a network call when the api key is empty', async () => {
    subDlApiKey.set('')
    expect(await createSubDL().search(SERIES)).toEqual([])
    expect(mocks.phttp).not.toHaveBeenCalled()
  })

  it('returns [] on a non-2xx response or a throw', async () => {
    mocks.phttp.mockResolvedValue({ ok: false, status: 500, text: async () => '', json: async () => ({}) })
    expect(await createSubDL().search(SERIES)).toEqual([])
    mocks.phttp.mockRejectedValue(new Error('network'))
    expect(await createSubDL().search(SERIES)).toEqual([])
  })
})
