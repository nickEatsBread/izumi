import { describe, expect, it } from 'vitest'
import { pickSubtitleTrackId } from './track-policy'
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
})
