import { describe, it, expect } from 'vitest'
import { selectSidecars, sidecarLanguage, sidecarTitle } from './sidecar-subs'
import fixture from './__fixtures__/sidecar-cases.json'

describe('selectSidecars (shared fixture)', () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const files = c.files.map((name, index) => ({ name, index }))
      const got = selectSidecars(files, files[c.video]).map((f) => f.index)
      expect(got).toEqual(c.expected)
    })
  }
})

describe('sidecarLanguage', () => {
  it('reads the language from a folder or filename token', () => {
    expect(sidecarLanguage('ENG/Show_01.ass')).toBe('eng')
    expect(sidecarLanguage('Subs/Show_01.chi_Maho.ass')).toBe('chi')
  })
  it('returns und rather than guessing', () => {
    expect(sidecarLanguage('Subs/Show_01.ass')).toBe('und')
  })
})

describe('sidecarTitle', () => {
  it('drops the language word and keeps the variant', () => {
    expect(sidecarTitle('Show_01.mkv', 'CHI/Show_01.chi_Maho.sub_karaoke.ass')).toBe('Maho sub karaoke')
  })
  it('falls back to a generic label when nothing distinguishes the track', () => {
    expect(sidecarTitle('Show_01.mkv', 'ENG/Show_01.eng.ass')).toBe('Subtitle')
  })
})
