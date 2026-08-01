import { describe, it, expect } from 'vitest'
import { providerBadge, candidateTitle, candidateKey, isCandidateLoaded, candidateApiKey, candidateDownloadUrl } from './online-subs'
import { subtitleErrorNotice } from './online-subs'
import { subDlApiKey, jimakuApiKey } from '$lib/settings/ui'
import { OPEN_SUBS_API_KEY } from '$lib/stremio/subtitles/opensubtitles'
import type { SubtitleCandidate } from '$lib/stremio/subtitles/types'

describe('providerBadge', () => {
  it('maps provider ids to display names', () => {
    expect(providerBadge('opensubtitles')).toBe('OpenSubtitles')
    expect(providerBadge('subdl')).toBe('SubDL')
    expect(providerBadge('jimaku')).toBe('Jimaku')
    expect(providerBadge('addon')).toBe('Addon')
  })
})

describe('candidateApiKey', () => {
  it('hands each bring-your-own-key provider its own key, OpenSubtitles the embedded one', () => {
    subDlApiKey.set('SKEY')
    jimakuApiKey.set('JKEY')
    expect(candidateApiKey('subdl')).toBe('SKEY')
    expect(candidateApiKey('jimaku')).toBe('JKEY')
    expect(candidateApiKey('opensubtitles')).toBe(OPEN_SUBS_API_KEY)
  })
})

describe('candidateDownloadUrl', () => {
  it('reads the SubDL zip or the Jimaku file url, and nothing for OpenSubtitles', () => {
    expect(candidateDownloadUrl({ provider: 'subdl', download: { needsFetch: true, zipUrl: 'https://dl/z.zip' } })).toBe('https://dl/z.zip')
    expect(candidateDownloadUrl({ provider: 'jimaku', download: { needsFetch: true, fileUrl: 'https://jimaku.cc/entry/9/download/s.srt' } })).toBe('https://jimaku.cc/entry/9/download/s.srt')
    expect(candidateDownloadUrl({ provider: 'opensubtitles', download: { needsFetch: true, fileId: 5 } })).toBeUndefined()
  })
})

describe('candidateTitle', () => {
  it('joins lang and release', () => {
    const c: SubtitleCandidate = { provider: 'subdl', lang: 'en', release: 'WEB-DL' }
    expect(candidateTitle(c)).toBe('en · WEB-DL')
  })
  it('falls back to und and the provider name', () => {
    const c: SubtitleCandidate = { provider: 'opensubtitles' }
    expect(candidateTitle(c)).toBe('und · opensubtitles')
  })
})

describe('candidateKey', () => {
  it('keys OpenSubtitles candidates by file id', () => {
    const c: SubtitleCandidate = { provider: 'opensubtitles', download: { needsFetch: true, fileId: 123 } }
    expect(candidateKey(c)).toBe('opensubtitles:123')
  })
  it('keys SubDL candidates by zip url', () => {
    const c: SubtitleCandidate = { provider: 'subdl', download: { needsFetch: true, zipUrl: 'https://dl.subdl.com/a.zip' } }
    expect(candidateKey(c)).toBe('subdl:https://dl.subdl.com/a.zip')
  })
  it('keys Jimaku candidates by file url', () => {
    const c: SubtitleCandidate = { provider: 'jimaku', download: { needsFetch: true, fileUrl: 'https://jimaku.cc/entry/9/download/s.srt' } }
    expect(candidateKey(c)).toBe('jimaku:https://jimaku.cc/entry/9/download/s.srt')
  })
  it('keys addon candidates by url', () => {
    const c: SubtitleCandidate = { provider: 'addon', url: 'https://x/e.srt' }
    expect(candidateKey(c)).toBe('addon:https://x/e.srt')
  })
})

describe('isCandidateLoaded', () => {
  const c: SubtitleCandidate = { provider: 'subdl', lang: 'en', release: 'WEB-DL' }
  it('true when a selected track carries the candidate title', () => {
    expect(isCandidateLoaded(c, ['en · WEB-DL'])).toBe(true)
  })
  it('false otherwise', () => {
    expect(isCandidateLoaded(c, ['fr · OTHER'])).toBe(false)
  })
})

describe('subtitleErrorNotice', () => {
  it('surfaces the quota message for an OpenSubtitles 401 quota body', () => {
    const n = subtitleErrorNotice('opensubtitles', 'opensubtitles /download 401: You have downloaded your allowed 20 subtitles for 24 hours.')
    expect(n).toContain('limit reached')
    expect(n).toContain('Settings → Subtitles')
  })
  it('falls back to a generic notice for a network error', () => {
    expect(subtitleErrorNotice('subdl', new Error('zip fetch failed'))).toBe('Subtitle download failed')
  })
})
