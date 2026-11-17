import { describe, expect, it } from 'vitest'
import { pickSubtitleTrackId, selectedAudioLang } from './track-policy'
import type { Track } from './track-label'

const sub = (partial: Partial<Track>): Track => ({ id: 0, type: 'sub', ...partial })

describe('pickSubtitleTrackId', () => {
  const pack: Track[] = [
    sub({ id: 1, lang: 'eng', title: 'Signs & Songs' }),
    sub({ id: 2, lang: 'eng', title: 'Full Subtitles' }),
    sub({ id: 3, lang: 'eng', title: 'English SDH' }),
    sub({ id: 4, lang: 'jpn', title: 'Japanese' }),
  ]

  it('turns subtitles off when the preference is none', () => {
    expect(pickSubtitleTrackId(pack, 'jpn', 'none')).toBe('no')
  })

  it('picks full English dialogue for a Japanese-audio sub watch', () => {
    expect(pickSubtitleTrackId(pack, 'jpn', 'eng')).toBe(2)
  })

  it('picks Signs & Songs for an English dub, not full English dialogue', () => {
    expect(pickSubtitleTrackId(pack, 'eng', 'eng')).toBe(1)
  })

  it('turns subs off on a dub when there is no signs or forced track', () => {
    expect(pickSubtitleTrackId([
      sub({ id: 2, lang: 'eng', title: 'Full Subtitles' }),
    ], 'eng', 'eng')).toBe('no')
  })

  it('matches BCP-47 locales like en-US', () => {
    expect(pickSubtitleTrackId([
      sub({ id: 10_000, lang: 'en-US', title: 'English' }),
      sub({ id: 10_001, lang: 'de-DE', title: 'German' }),
    ], 'jpn', 'eng')).toBe(10_000)
  })

  it('does not silently replace requested English with a labelled foreign track', () => {
    expect(pickSubtitleTrackId([
      sub({ id: 5, lang: 'fra', title: 'Français' }),
      sub({ id: 6, lang: 'rus', title: 'Русский' }),
    ], 'jpn', 'eng')).toBeUndefined()
  })

  it('still accepts an unlabelled sole subtitle track', () => {
    expect(pickSubtitleTrackId([
      sub({ id: 7, title: 'Full Subtitles' }),
    ], 'jpn', 'eng')).toBe(7)
  })

  it('walks the subtitle order to the first language that has a track', () => {
    const tracks = [
      sub({ id: 1, lang: 'fre', title: 'Français' }),
      sub({ id: 2, lang: 'ger', title: 'Deutsch' }),
    ]
    expect(pickSubtitleTrackId(tracks, 'jpn', ['eng', 'ger', 'fre'])).toBe(2)
    expect(pickSubtitleTrackId(tracks, 'jpn', 'eng,fre')).toBe(1)
  })

  it('keeps a regional subtitle apart from another region of the same language', () => {
    const tracks = [
      sub({ id: 1, lang: 'es-ES', title: 'Español (España)' }),
      sub({ id: 2, lang: 'es-419', title: 'Español (América Latina)' }),
    ]
    expect(pickSubtitleTrackId(tracks, 'ja-JP', ['es-419'])).toBe(2)
    expect(pickSubtitleTrackId(tracks, 'ja-JP', ['spa'])).toBe(1)
  })

  it('treats subtitles in the playing audio’s own language as a dub, for any language', () => {
    expect(pickSubtitleTrackId([
      sub({ id: 1, lang: 'ger', title: 'Deutsch' }),
      sub({ id: 2, lang: 'ger', title: 'Deutsch [Forced]', forced: true }),
    ], 'de-DE', ['ger'])).toBe(2)
  })
})

describe('selectedAudioLang', () => {
  it('reads the language of the selected audio track', () => {
    expect(selectedAudioLang([
      { id: 1, type: 'audio', lang: 'jpn' },
      { id: 2, type: 'audio', lang: 'eng', selected: true },
      sub({ id: 3, lang: 'fre', selected: true }),
    ])).toBe('eng')
  })
})
