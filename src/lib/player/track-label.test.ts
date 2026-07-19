import { describe, it, expect } from 'vitest'
import { trackLabel, langName, distinctiveTitle, chLabel, type Track } from './track-label'

const sub = (o: Partial<Track>): Track => ({ id: 0, type: 'sub', ...o })
const aud = (o: Partial<Track>): Track => ({ id: 0, type: 'audio', ...o })
const labels = (g: Track[]) => g.map((t) => trackLabel(t, g))

describe('langName', () => {
  it('maps ISO 639-2 and 639-1 codes to English names', () => {
    expect(langName('jpn')).toBe('Japanese')
    expect(langName('eng')).toBe('English')
    expect(langName('fre')).toBe('French')
    expect(langName('ja')).toBe('Japanese')
  })
  it('returns undefined for missing/undetermined languages', () => {
    expect(langName(undefined)).toBeUndefined()
    expect(langName('')).toBeUndefined()
    expect(langName('und')).toBeUndefined()
  })
  it('falls back to the upper-cased code for unknown languages', () => {
    expect(langName('zzz')).toBe('ZZZ')
  })
})

describe('distinctiveTitle', () => {
  it('drops generic and language-restating titles', () => {
    expect(distinctiveTitle('Full Subtitles', 'eng')).toBeUndefined()
    expect(distinctiveTitle('HDMV_PGS_SUBTITLE', 'eng')).toBeUndefined()
    expect(distinctiveTitle('English', 'eng')).toBeUndefined()      // would read "English · English"
    expect(distinctiveTitle('English SDH', 'eng')).toBeUndefined()  // SDH rendered as its own badge
    expect(distinctiveTitle('', 'eng')).toBeUndefined()
  })
  it('keeps titles that add real information', () => {
    expect(distinctiveTitle('Signs & Songs', 'eng')).toBe('Signs & Songs')
    expect(distinctiveTitle('Commentary', 'eng')).toBe('Commentary')
  })
})

describe('trackLabel — the "Your Name" case', () => {
  // 7 PGS subtitle tracks: identical generic title + identical codec, distinguished only by
  // language. The old title-first label rendered every row "Full Subtitles · HDMV_PGS_SUBTITLE".
  const yourName: Track[] = ['eng', 'jpn', 'spa', 'fre', 'ger', 'ita', 'por'].map((lang, i) =>
    sub({ id: i + 1, lang, title: 'Full Subtitles', codec: 'hdmv_pgs_subtitle' }),
  )

  it('labels each track by its language — all distinct, no codec noise', () => {
    expect(labels(yourName)).toEqual([
      'English', 'Japanese', 'Spanish', 'French', 'German', 'Italian', 'Portuguese',
    ])
  })

  it('produces no duplicate labels', () => {
    const out = labels(yourName)
    expect(new Set(out).size).toBe(out.length)
  })

  it('never shows the codec for subtitles', () => {
    expect(labels(yourName).some((l) => /pgs|hdmv/i.test(l))).toBe(false)
  })
})

describe('trackLabel — subtitles', () => {
  it('numbers same-language tracks so no two rows are identical', () => {
    const g = [sub({ id: 1, lang: 'eng' }), sub({ id: 2, lang: 'eng' })]
    expect(labels(g)).toEqual(['English (1)', 'English (2)'])
  })
  it('numbers untitled/untagged tracks instead of leaving them blank', () => {
    const g = [sub({ id: 1 }), sub({ id: 2, title: 'Full Subtitles' })]
    expect(labels(g)).toEqual(['Subtitle (1)', 'Subtitle (2)'])
  })
  it('surfaces Forced (flag or title) and SDH', () => {
    expect(trackLabel(sub({ id: 1, lang: 'eng', forced: true }), [sub({ id: 1, lang: 'eng', forced: true })])).toBe('English · Forced')
    expect(trackLabel(sub({ id: 1, lang: 'spa', title: 'Forced' }), [sub({ id: 1, lang: 'spa', title: 'Forced' })])).toBe('Spanish · Forced')
    expect(trackLabel(sub({ id: 1, lang: 'eng', title: 'English SDH' }), [sub({ id: 1, lang: 'eng', title: 'English SDH' })])).toBe('English · SDH')
  })
  it('appends a distinctive title after the language', () => {
    const t = sub({ id: 1, lang: 'eng', title: 'Signs & Songs' })
    expect(trackLabel(t, [t])).toBe('English · Signs & Songs')
  })
})

describe('trackLabel — audio', () => {
  it('shows channel layout, and the codec only to disambiguate same-language tracks', () => {
    const g = [
      aud({ id: 1, lang: 'eng', channels: 6, codec: 'dts' }),
      aud({ id: 2, lang: 'eng', channels: 6, codec: 'aac' }),
    ]
    expect(labels(g)).toEqual(['English · 5.1 · DTS', 'English · 5.1 · AAC'])
  })
  it('does not add a codec when a single track already reads uniquely', () => {
    const t = aud({ id: 1, lang: 'jpn', channels: 2, codec: 'aac' })
    expect(trackLabel(t, [t])).toBe('Japanese · 2.0')
  })
})

describe('chLabel', () => {
  it('maps channel counts to layout names', () => {
    expect(chLabel(8)).toBe('7.1')
    expect(chLabel(6)).toBe('5.1')
    expect(chLabel(2)).toBe('2.0')
    expect(chLabel(1)).toBe('Mono')
    expect(chLabel(undefined)).toBe('')
  })
})
