import { describe, it, expect } from 'vitest'
import { normalizeLang, subtitleTitle, SOURCE_LANGUAGES } from './sublang'
import { langName } from '$lib/player/track-label'

describe('SOURCE_LANGUAGES', () => {
  it('offers ISO 639-1 codes, unique and sorted', () => {
    // Provider manifests declare 639-1, so that is what is stored and compared against.
    expect(SOURCE_LANGUAGES.every((c) => /^[a-z]{2}$/.test(c))).toBe(true)
    expect(new Set(SOURCE_LANGUAGES).size).toBe(SOURCE_LANGUAGES.length)
    expect([...SOURCE_LANGUAGES].sort()).toEqual(SOURCE_LANGUAGES)
  })

  it('covers far more than a typical catalog declares', () => {
    // The point of the change: the old chip list was built from installed manifests only, so a
    // language no installed source declared could never be chosen.
    for (const code of ['en', 'ja', 'fr', 'de', 'it', 'es', 'pt', 'ru', 'ar', 'ko', 'zh', 'id', 'tr', 'pl', 'th', 'vi']) {
      expect(SOURCE_LANGUAGES).toContain(code)
    }
    expect(SOURCE_LANGUAGES.length).toBeGreaterThan(25)
  })

  it('every offered code resolves to a real display name, never a bare code', () => {
    // A code with no name would render as "SR" in the dropdown and read as noise.
    for (const code of SOURCE_LANGUAGES) {
      const name = langName(code)
      expect(name, `no display name for '${code}'`).toBeTruthy()
      expect(name!.toLowerCase()).not.toBe(code)
    }
  })

  it('every offered code is one the normalizer understands', () => {
    for (const code of SOURCE_LANGUAGES) expect(normalizeLang(code), code).toBeTruthy()
  })
})

describe('normalizeLang', () => {
  it('maps ISO 639-1 and 639-2 to a single 639-2/B code', () => {
    expect(normalizeLang('en')).toBe('eng')
    expect(normalizeLang('eng')).toBe('eng')
    expect(normalizeLang('fr')).toBe('fre')
    expect(normalizeLang('fra')).toBe('fre')
    expect(normalizeLang('ja')).toBe('jpn')
  })

  it('maps English and native language names', () => {
    expect(normalizeLang('French')).toBe('fre')
    expect(normalizeLang('Français')).toBe('fre')
    expect(normalizeLang('Deutsch')).toBe('ger')
    expect(normalizeLang('日本語')).toBe('jpn')
    expect(normalizeLang('Bahasa Indonesia')).toBe('ind')
  })

  it('is case and whitespace insensitive', () => {
    expect(normalizeLang('  ENGLISH  ')).toBe('eng')
    expect(normalizeLang('Eng')).toBe('eng')
  })

  it('resolves region-tagged and decorated labels', () => {
    expect(normalizeLang('pt-BR')).toBe('por')
    expect(normalizeLang('en-US')).toBe('eng')
    expect(normalizeLang('English [CC]')).toBe('eng')
    expect(normalizeLang('eng-forced')).toBe('eng')
    expect(normalizeLang('English (SDH)')).toBe('eng')
  })

  it('returns undefined for a label with no language in it', () => {
    // A real label captured from a live provider — a release-group name, not a language. Guessing
    // here would make mpv auto-select an arbitrary track.
    expect(normalizeLang('wowmdildo {+Eternal Blizzard}')).toBeUndefined()
    expect(normalizeLang('Track 1')).toBeUndefined()
    expect(normalizeLang('')).toBeUndefined()
    expect(normalizeLang(undefined)).toBeUndefined()
  })

  it('does not let a noise word match on its own', () => {
    expect(normalizeLang('Subtitles')).toBeUndefined()
    expect(normalizeLang('forced')).toBeUndefined()
  })
})

describe('subtitleTitle', () => {
  it("keeps the provider's own label for the menu", () => {
    expect(subtitleTitle('wowmdildo {+Eternal Blizzard}')).toBe('wowmdildo {+Eternal Blizzard}')
    expect(subtitleTitle('English [CC]')).toBe('English [CC]')
  })

  it('falls back when there is no label', () => {
    expect(subtitleTitle(undefined)).toBe('Subtitles')
    expect(subtitleTitle('   ')).toBe('Subtitles')
  })
})
