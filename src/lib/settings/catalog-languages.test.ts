import { get } from 'svelte/store'
import { describe, expect, it } from 'vitest'
import {
  catalogDefaults,
  documentLanguages,
  rememberSourceLanguages,
  sourceAccountLanguages,
  catalogOfMedia,
  mpvLanguageList,
  rankingLanguages,
  resolveLanguageOrder,
  storedOrder,
} from './catalog-languages'

describe('catalog of a title', () => {
  it('folds AniList, Kitsu and Aniyomi titles into the anime catalog', () => {
    expect(catalogOfMedia({})).toBe('anime')
    expect(catalogOfMedia({ catalog: { provider: 'kitsu', id: '1', type: 'anime' } })).toBe('anime')
    expect(catalogOfMedia({ catalog: { provider: 'jvm', id: '1', type: 'anime' } })).toBe('anime')
  })

  it('keeps TMDB, Stremio add-ons and each source catalog apart', () => {
    expect(catalogOfMedia({ catalog: { provider: 'tmdb', id: '603', type: 'movie' } })).toBe('tmdb')
    expect(catalogOfMedia({ catalog: { provider: 'stremio', id: 'tt1', type: 'movie', addonId: '0123456789abcdef' } })).toBe('stremio')
    expect(catalogOfMedia({ catalog: { provider: 'stremio', id: 'v:1', type: 'series', addonId: 'source-video.example' } }))
      .toBe('source:video.example')
  })
})

describe('catalog defaults', () => {
  it('plays anime in Japanese with English subtitles, then the system language', () => {
    expect(catalogDefaults('anime', 'fr-FR')).toEqual({ audio: ['jpn'], subtitle: ['eng', 'fre'] })
    expect(catalogDefaults('anime', 'en-GB')).toEqual({ audio: ['jpn'], subtitle: ['eng'] })
    expect(catalogDefaults('anime', undefined)).toEqual({ audio: ['jpn'], subtitle: ['eng'] })
  })

  it('plays films, series and sources in the system language', () => {
    expect(catalogDefaults('tmdb', 'de-DE')).toEqual({ audio: ['ger'], subtitle: ['ger'] })
    expect(catalogDefaults('stremio', 'ja')).toEqual({ audio: ['jpn'], subtitle: ['jpn'] })
    expect(catalogDefaults('source:video.example', 'es-419')).toEqual({ audio: ['spa'], subtitle: ['spa'] })
  })

  it('falls back to English when the system language is unknown', () => {
    expect(catalogDefaults('tmdb', 'zz')).toEqual({ audio: ['eng'], subtitle: ['eng'] })
  })
})

describe('fallback order', () => {
  const locale = 'fr-FR'

  it('uses the catalog default when nothing is set', () => {
    expect(resolveLanguageOrder({ catalog: 'anime', locale })).toEqual({ audio: ['jpn'], subtitle: ['eng', 'fre'] })
    expect(resolveLanguageOrder({ catalog: 'tmdb', global: {}, locale })).toEqual({ audio: ['fre'], subtitle: ['fre'] })
  })

  it('lets a set global order replace the defaults, kind by kind', () => {
    const global = { audio: ['eng'] }
    expect(resolveLanguageOrder({ catalog: 'anime', global, locale })).toEqual({ audio: ['eng'], subtitle: ['eng', 'fre'] })
    expect(resolveLanguageOrder({ catalog: 'tmdb', global, locale })).toEqual({ audio: ['eng'], subtitle: ['fre'] })
  })

  it('puts a catalog’s own order ahead of the global order', () => {
    expect(resolveLanguageOrder({
      catalog: 'tmdb',
      own: { subtitle: ['none'] },
      global: { audio: ['eng'], subtitle: ['eng'] },
      locale,
    })).toEqual({ audio: ['eng'], subtitle: ['none'] })
  })

  it('puts a source account’s preference ahead of everything else', () => {
    expect(resolveLanguageOrder({
      catalog: 'source:video.example',
      account: { audio: ['en-US'] },
      own: { audio: ['jpn'], subtitle: ['spa'] },
      global: { audio: ['ger'], subtitle: ['ger'] },
      locale,
    })).toEqual({ audio: ['en-US'], subtitle: ['spa'] })
  })

  it('treats an empty order as no opinion', () => {
    expect(resolveLanguageOrder({ catalog: 'anime', account: { audio: [] }, own: { audio: [] }, locale }).audio).toEqual(['jpn'])
  })
})

describe('stored global rows', () => {
  it('reads Automatic as no order', () => {
    expect(storedOrder('auto')).toBeUndefined()
    expect(storedOrder('')).toBeUndefined()
    expect(storedOrder(undefined)).toBeUndefined()
  })

  it('reads one code or a comma-separated order', () => {
    expect(storedOrder('eng')).toEqual(['eng'])
    expect(storedOrder('jpn, eng')).toEqual(['jpn', 'eng'])
    expect(storedOrder('none')).toEqual(['none'])
  })
})

describe('mpv language lists', () => {
  it('adds the ISO 639-2 form of each tag, once', () => {
    expect(mpvLanguageList(['es-419', 'eng'])).toBe('es-419,spa,eng')
    expect(mpvLanguageList(['ja-JP', 'jpn'])).toBe('ja-jp,jpn')
  })

  it('keeps subtitles off', () => {
    expect(mpvLanguageList(['none'])).toBe('none')
  })
})

describe('ranking languages', () => {
  it('ranks by the first wanted language as ISO 639-2', () => {
    expect(rankingLanguages({ audio: ['ja-JP', 'eng'], subtitle: ['en-US'] })).toEqual({ audioLang: 'jpn', subtitleLang: 'eng' })
    expect(rankingLanguages({ audio: ['eng'], subtitle: ['none'] })).toEqual({ audioLang: 'eng', subtitleLang: 'none' })
  })
})

describe('source account languages', () => {
  const languages = { audio: 'audioLanguage', subtitle: 'subtitleLanguage' }

  it('reads the named fields as one-language orders, an empty subtitle as off', () => {
    expect(documentLanguages({ languages, values: { audioLanguage: 'en-US', subtitleLanguage: '' } }, 5))
      .toEqual({ audio: ['en-US'], subtitle: ['none'], at: 5 })
    expect(documentLanguages({ languages, values: { audioLanguage: '', subtitleLanguage: 'es-419' } }, 5))
      .toEqual({ subtitle: ['es-419'], at: 5 })
  })

  it('says nothing when the fields are not there', () => {
    expect(documentLanguages({ languages, values: {} })).toBeUndefined()
    expect(documentLanguages({ values: { audioLanguage: 'en-US' } })).toBeUndefined()
  })

  it('keeps, holds and drops what a source reports', () => {
    sourceAccountLanguages.set({})
    rememberSourceLanguages('video.example', { languages, values: { audioLanguage: 'ja-JP', subtitleLanguage: 'en-US' } })
    expect(get(sourceAccountLanguages)['video.example']).toMatchObject({ audio: ['ja-JP'], subtitle: ['en-US'] })
    // Details still loading: hold the last answer.
    rememberSourceLanguages('video.example', { languages, values: {} })
    expect(get(sourceAccountLanguages)['video.example']?.audio).toEqual(['ja-JP'])
    // A document missing one value keeps that kind and takes the other.
    rememberSourceLanguages('video.example', { languages, values: { subtitleLanguage: 'fr-FR' } })
    expect(get(sourceAccountLanguages)['video.example']).toMatchObject({ audio: ['ja-JP'], subtitle: ['fr-FR'] })
    // Signed out: the document names no language fields.
    rememberSourceLanguages('video.example', { values: {} })
    expect(get(sourceAccountLanguages)).toEqual({})
  })
})
