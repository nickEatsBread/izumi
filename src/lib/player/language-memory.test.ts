import { get } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const settings = vi.hoisted(() => ({
  document: {
    version: 1 as const,
    fields: [
      { key: 'audioLanguage', label: 'Audio', type: 'select' as const, section: 'languages' as const, options: [{ value: 'en-US', label: 'English' }, { value: 'ja-JP', label: 'Japanese' }, { value: 'es-419', label: 'Spanish (Latin America)' }, { value: 'es-ES', label: 'Spanish (Spain)' }] },
      { key: 'subtitleLanguage', label: 'Subtitles', type: 'select' as const, section: 'languages' as const, options: [{ value: 'en-US', label: 'English' }, { value: 'de-DE', label: 'German' }] },
    ],
    values: { audioLanguage: 'en-US', subtitleLanguage: 'en-US' } as Record<string, string>,
    languages: { audio: 'audioLanguage', subtitle: 'subtitleLanguage' },
  },
  saved: [] as Array<[string, string, unknown]>,
}))
vi.mock('$lib/extensions/manager', () => ({
  extensionServiceSettings: vi.fn(async () => settings.document),
  saveExtensionServiceSettings: vi.fn(async (id: string, values: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(values)) settings.saved.push([id, key, value])
    return { ok: true, ...settings.document }
  }),
}))

const { catalogLanguages, sourceAccountLanguages } = await import('$lib/settings/catalog-languages')
const { preferredAudioLang, preferredSubLang } = await import('$lib/settings/ui')
const { nowPlayingMedia } = await import('./session')
const { accountOption } = await import('$lib/extensions/source-languages')
const { pickedLanguage, rememberLanguagePick, rememberLanguagePicks, rememberNowPlayingLanguage, withPick } = await import('./language-memory')

const anime = { catalog: undefined }
const tmdb = { catalog: { provider: 'tmdb' as const, id: '1', type: 'series' as const } }
const source = { catalog: { provider: 'stremio' as const, id: 'v:1', type: 'series' as const, addonId: 'source-video.example' } }
const flush = () => new Promise((resolve) => setTimeout(resolve, 50))

beforeEach(() => {
  catalogLanguages.set({})
  sourceAccountLanguages.set({})
  preferredAudioLang.set('auto')
  preferredSubLang.set('auto')
  rememberLanguagePicks.set(true)
  settings.saved = []
})

describe('the language a pick stands for', () => {
  it('reads the track tag, subtitles off, and nothing for a track without a language', () => {
    expect(pickedLanguage('audio', { lang: 'eng' })).toBe('eng')
    expect(pickedLanguage('subtitle', null)).toBe('none')
    expect(pickedLanguage('audio', null)).toBeUndefined()
    expect(pickedLanguage('audio', { lang: 'und' })).toBeUndefined()
    expect(pickedLanguage('subtitle', {})).toBeUndefined()
  })

  it('puts the pick first and drops the same language further down', () => {
    expect(withPick(['jpn', 'eng'], 'en')).toEqual(['en', 'jpn'])
    expect(withPick(['none'], 'eng')).toEqual(['eng'])
    expect(withPick(['eng', 'fre'], 'none')).toEqual(['none'])
    expect(withPick(undefined, 'es-419')).toEqual(['es-419'])
  })
})

describe('remembering a pick for the catalog', () => {
  it('makes it the catalog’s own order for the profile', () => {
    rememberLanguagePick(anime, 'audio', { lang: 'eng' })
    rememberLanguagePick(anime, 'subtitle', null)
    rememberLanguagePick(tmdb, 'subtitle', { lang: 'ger' })
    expect(get(catalogLanguages)).toEqual({ anime: { audio: ['eng'], subtitle: ['none'] }, tmdb: { subtitle: ['ger'] } })
  })

  it('leaves a catalog alone when the pick is where it already starts', () => {
    rememberLanguagePick(anime, 'audio', { lang: 'ja' })
    expect(get(catalogLanguages)).toEqual({})
  })

  it('does nothing while the setting is off', () => {
    rememberLanguagePicks.set(false)
    rememberLanguagePick(anime, 'audio', { lang: 'eng' })
    expect(get(catalogLanguages)).toEqual({})
  })

  it('only follows the title that is playing', () => {
    nowPlayingMedia.set({ media: { id: 7, ...tmdb } as never, episode: 1 })
    rememberNowPlayingLanguage(8, 'audio', { lang: 'fre' })
    expect(get(catalogLanguages)).toEqual({})
    rememberNowPlayingLanguage(7, 'audio', { lang: 'fre' })
    expect(get(catalogLanguages).tmdb).toEqual({ audio: ['fre'] })
  })

  it('saves it to a source account that holds the catalog’s languages', async () => {
    sourceAccountLanguages.set({ 'video.example': { audio: ['en-US'], subtitle: ['en-US'], at: 1 } })
    rememberLanguagePick(source, 'audio', { lang: 'ja' })
    rememberLanguagePick(source, 'subtitle', { lang: 'de-DE' })
    await vi.waitFor(() => expect(settings.saved).toHaveLength(2))
    expect(settings.saved).toEqual(expect.arrayContaining([['video.example', 'audioLanguage', 'ja-JP'], ['video.example', 'subtitleLanguage', 'de-DE']]))
    expect(get(catalogLanguages)['source:video.example']).toEqual({ audio: ['ja'], subtitle: ['de-DE'] })
  })

  it('keeps a pick the account can’t hold as izumi’s own', async () => {
    sourceAccountLanguages.set({ 'video.example': { audio: ['en-US'], subtitle: ['en-US'], at: 1 } })
    rememberLanguagePick(source, 'subtitle', null)
    await flush()
    expect(settings.saved).toEqual([])
    expect(get(catalogLanguages)['source:video.example']).toEqual({ subtitle: ['none'] })
  })

  it('never writes to a source that reports no account languages', async () => {
    rememberLanguagePick(source, 'audio', { lang: 'jpn' })
    await flush()
    expect(settings.saved).toEqual([])
  })
})

describe('the account option for a pick', () => {
  const options = settings.document.fields[0].options
  it('prefers the exact tag, then the current value, then the first of that language', () => {
    expect(accountOption(options, 'es-419', 'en-US')).toBe('es-419')
    expect(accountOption(options, 'spa', 'es-ES')).toBe('es-ES')
    expect(accountOption(options, 'jpn', 'en-US')).toBe('ja-JP')
    expect(accountOption(options, 'kor', 'en-US')).toBeUndefined()
    expect(accountOption(options, 'none', 'en-US')).toBeUndefined()
  })
})
