import { describe, it, expect } from 'vitest'
import { pickSubtitleId } from './subtitles'

const IMDB = 'tt2560140:1:5'
const KITSU = 'kitsu:7442:5'

describe('pickSubtitleId (route the id format by the addon\'s declared idPrefixes)', () => {
  it('uses imdb when the addon accepts tt ids', () => {
    expect(pickSubtitleId(['tt'], IMDB, KITSU)).toBe(IMDB)
  })
  it('uses kitsu when the addon accepts kitsu ids', () => {
    expect(pickSubtitleId(['kitsu'], IMDB, KITSU)).toBe(KITSU)
  })
  it('defaults to imdb (OpenSubtitles) when the addon declares no matching prefix', () => {
    expect(pickSubtitleId(undefined, IMDB, KITSU)).toBe(IMDB)
    expect(pickSubtitleId([], IMDB, KITSU)).toBe(IMDB)
  })
  it('falls back to whatever id exists when only one is available', () => {
    expect(pickSubtitleId(['tt'], undefined, KITSU)).toBe(KITSU)
    expect(pickSubtitleId(['kitsu'], IMDB, undefined)).toBe(IMDB)
  })
  it('returns undefined when there is no id at all', () => {
    expect(pickSubtitleId(['tt'], undefined, undefined)).toBeUndefined()
  })
})
