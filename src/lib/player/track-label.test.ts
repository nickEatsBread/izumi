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
    expect(langName('en-US')).toBe('English')
    expect(langName('ja-JP')).toBe('Japanese')
    expect(langName('es-419')).toBe('Spanish (Latin America)')
    expect(langName('es-ES')).toBe('Spanish (Spain)')
    expect(langName('pt-BR')).toBe('Portuguese (Brazil)')
    expect(langName('zh-HK')).toBe('Chinese (Hong Kong)')
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
    expect(labels(g)).toEqual(['English · Track 1', 'English · Track 2'])
  })
  it('makes untitled/untagged tracks explicit instead of showing ambiguous Subtitle (n) labels', () => {
    const g = [sub({ id: 1 }), sub({ id: 2, title: 'Full Subtitles' })]
    expect(labels(g)).toEqual(['Unlabelled subtitle · Track 1', 'Unlabelled subtitle · Track 2'])
  })
  it('identifies untagged Blu-ray image subtitles by their format', () => {
    const g = [
      sub({ id: 1, codec: 'hdmv_pgs_subtitle' }),
      sub({ id: 2, codec: 'hdmv_pgs_subtitle' }),
    ]
    expect(labels(g)).toEqual([
      'Unlabelled Blu-ray subtitle · Track 1',
      'Unlabelled Blu-ray subtitle · Track 2',
    ])
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

  it('recovers a language retained only in an external subtitle filename', () => {
    const t = sub({ id: 1, external: true, externalFilename: '/tmp/episode.pt-BR.ass' })
    expect(trackLabel(t, [t])).toBe('Portuguese (Brazil)')
  })

  it('corrects anime muxes that tag full English dialogue by Japanese audio', () => {
    const g = [
      sub({ id: 1, lang: 'eng', title: 'Signs & Songs (Shio-freeka)' }),
      sub({ id: 2, lang: 'jpn', title: 'Full Subtitles (Shio-freeka)' }),
      sub({ id: 3, lang: 'eng', title: 'Signs & Songs (Coalgirls)' }),
      sub({ id: 4, lang: 'jpn', title: 'Full Subtitles (Coalgirls)' }),
    ]
    expect(labels(g)).toEqual([
      'English · Signs & Songs (Shio-freeka)',
      'English · Full Subtitles (Shio-freeka)',
      'English · Signs & Songs (Coalgirls)',
      'English · Full Subtitles (Coalgirls)',
    ])
  })
})

describe('trackLabel — malformed YTS Matrix mux', () => {
  const brokenMux: Track[] = [
    sub({ id: 2, lang: 'eng', title: 'English-SRT', codec: 'subrip', default: true }),
    ...Array.from({ length: 26 }, (_, index) => sub({
      id: index + 3,
      codec: 'hdmv_pgs_subtitle',
      external: false,
    })),
  ]
  const context = {
    filename: 'The.Matrix.1999.2160p.4K.BluRay.x265.10bit.AAC5.1-[YTS.MX].mkv',
  }

  it('recovers the verified English PGS track and gives the unknown tracks honest useful labels', () => {
    const out = brokenMux.map((track) => trackLabel(track, brokenMux, context))
    expect(out[0]).toBe('English · English-SRT')
    expect(out[1]).toBe('English')
    expect(out[2]).toBe('Unlabelled Blu-ray subtitle · Track 1')
    expect(out[26]).toBe('Unlabelled Blu-ray subtitle · Track 25')
    expect(new Set(out).size).toBe(out.length)
  })

  it('does not guess English when the release filename or stream layout differs', () => {
    expect(trackLabel(brokenMux[1], brokenMux, { filename: 'Different.Movie.mkv' }))
      .toBe('Unlabelled Blu-ray subtitle · Track 1')
    expect(trackLabel(brokenMux[1], brokenMux.slice(0, 26), context))
      .toBe('Unlabelled Blu-ray subtitle · Track 1')
  })
})

describe('trackLabel — malformed MeGusta Crunchyroll mux', () => {
  const brokenMux: Track[] = Array.from({ length: 10 }, (_, index) => sub({
    id: index + 2,
    lang: '',
    title: '',
    codec: 'ass',
    default: index === 0,
    forced: index === 0,
    external: false,
    externalFilename: '',
  }))
  const context = {
    filename: 'Skeleton.Knight.in.Another.World.S02E08.1080p.HEVC.x265-MeGusta[EZTVx.to].mkv',
  }

  it('recovers every language and ignores the incorrect forced flag on full English dialogue', () => {
    expect(brokenMux.map((track) => trackLabel(track, brokenMux, context))).toEqual([
      'English',
      'Arabic',
      'Portuguese (Brazil)',
      'Spanish (Spain)',
      'French',
      'German',
      'Italian',
      'Spanish (Latin America)',
      'Polish',
      'Russian',
    ])
  })

  it('does not guess for an unrelated release or a layout that differs', () => {
    expect(trackLabel(brokenMux[0], brokenMux, { filename: 'Unknown.Group.mkv' })).toBe('Unlabelled subtitle · Forced')
    expect(trackLabel(brokenMux[0], brokenMux.slice(0, 9), context)).toBe('Unlabelled subtitle · Forced')
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

  it('keeps Spanish and Portuguese regions distinct instead of numbering them', () => {
    const g = [
      aud({ id: 1, lang: 'ja-JP' }),
      aud({ id: 2, lang: 'en-US' }),
      aud({ id: 3, lang: 'es-419' }),
      aud({ id: 4, lang: 'es-ES' }),
      aud({ id: 5, lang: 'pt-BR' }),
    ]
    expect(labels(g)).toEqual([
      'Japanese',
      'English',
      'Spanish (Latin America)',
      'Spanish (Spain)',
      'Portuguese (Brazil)',
    ])
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
