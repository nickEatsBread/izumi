import { describe, it, expect } from 'vitest'
import { parseFileEpisode, pickVideoFile } from './episode-file'

describe('parseFileEpisode', () => {
  it('parses the " - NN" fansub convention (the reported batch)', () => {
    expect(parseFileEpisode('[Emotion] Boku no Risou no Isekai Seikatsu - 01 (DVD 720x480 x264).mkv')).toEqual({ episode: 1 })
    expect(parseFileEpisode('[Emotion] Boku no Risou no Isekai Seikatsu - 04 (DVD 720x480 x264).mkv')).toEqual({ episode: 4 })
  })
  it('does not read resolution or codec tokens as episodes', () => {
    // 720x480 composite, 1080p, x264/x265, 8/10-bit, years, audio channels
    expect(parseFileEpisode('Title - 03 [1080p][x265][10bit].mkv')).toEqual({ episode: 3 })
    expect(parseFileEpisode('Title 2020 - 05 (1920x1080 h264 AAC2.0).mkv')).toEqual({ episode: 5 })
    expect(parseFileEpisode('Movie Name (2019) 1080p BluRay x264.mkv')).toEqual({})
  })
  it('parses SxxExx (with version tags) and keeps the season', () => {
    expect(parseFileEpisode('Show.S02E04.1080p.WEB.mkv')).toEqual({ season: 2, episode: 4 })
    expect(parseFileEpisode('Show S01E10v2 [ABCD1234].mkv')).toEqual({ season: 1, episode: 10 })
  })
  it('parses season markers alongside hyphen episodes ("S01 - 04")', () => {
    expect(parseFileEpisode('Show S01 - 04 [720p].mkv')).toEqual({ season: 1, episode: 4 })
  })
  it('parses E / Ep / Episode / # forms', () => {
    expect(parseFileEpisode('Show E04.mkv')).toEqual({ episode: 4 })
    expect(parseFileEpisode('Show Ep 4 [720p].mkv')).toEqual({ episode: 4 })
    expect(parseFileEpisode('Show Episode 12.mkv')).toEqual({ episode: 12 })
    expect(parseFileEpisode('Show #05.mkv')).toEqual({ episode: 5 })
  })
  it('parses 1x04 style but never resolution-sized pairs', () => {
    expect(parseFileEpisode('Show 1x04 HDTV.mkv')).toEqual({ season: 1, episode: 4 })
    expect(parseFileEpisode('Show 640x480.mkv')).toEqual({})
  })
  it('is not fooled by hex CRC groups', () => {
    // [ABC1E404] must not produce episode 404; the bracket tag is stripped whole.
    expect(parseFileEpisode('[Group] Show - 07 [ABC1E404].mkv')).toEqual({ episode: 7 })
    expect(parseFileEpisode('[Group] Show 03 [1E404BCD].mkv')).toEqual({ episode: 3 })
  })
  it('parses underscore-delimited names', () => {
    expect(parseFileEpisode('Show_-_04_(720p).mkv')).toEqual({ episode: 4 })
  })
  it('parses episode ranges as a range, not the first bound', () => {
    expect(parseFileEpisode('Show - 01-04 (Batch).mkv')).toEqual({ range: [1, 4] })
    expect(parseFileEpisode('Show - 01~24.mkv')).toEqual({ range: [1, 24] })
  })
  it('falls back to a single unambiguous standalone number', () => {
    expect(parseFileEpisode('Boku no Risou no Isekai Seikatsu 02.mkv')).toEqual({ episode: 2 })
    // Two candidate numbers -> ambiguous -> no episode.
    expect(parseFileEpisode('Show 02 03.mkv')).toEqual({})
  })
  it('handles absolute numbering (long-runners)', () => {
    expect(parseFileEpisode('[Sub] One Piece - 1071 (1080p).mkv')).toEqual({ episode: 1071 })
  })
  it('strips directory paths first', () => {
    expect(parseFileEpisode('Season 1/Show - 02.mkv')).toEqual({ episode: 2 })
    expect(parseFileEpisode('Show\\Show S01E03.mkv')).toEqual({ season: 1, episode: 3 })
  })
  it('returns {} for extras and unparseable names', () => {
    expect(parseFileEpisode('NCOP.mkv')).toEqual({})
    expect(parseFileEpisode('Show OP1.mkv')).toEqual({})
  })
  it('parses .5 specials as fractional so they never equal an integer episode', () => {
    expect(parseFileEpisode('Show - 04.5 (Recap).mkv')).toEqual({ episode: 4.5 })
  })
})

describe('pickVideoFile', () => {
  // The exact reported batch: 4 episodes, ep 4 is the LARGEST file. Selecting ep 1
  // must pick file 01, not the largest.
  const emotionBatch = [
    { name: '[Emotion] Boku no Risou no Isekai Seikatsu - 04 (DVD 720x480 x264).mkv', bytes: 138.5e6 },
    { name: '[Emotion] Boku no Risou no Isekai Seikatsu - 03 (DVD 720x480 x264).mkv', bytes: 135.0e6 },
    { name: '[Emotion] Boku no Risou no Isekai Seikatsu - 02 (DVD 720x480 x264).mkv', bytes: 128.8e6 },
    { name: '[Emotion] Boku no Risou no Isekai Seikatsu - 01 (DVD 720x480 x264).mkv', bytes: 130.4e6 },
  ]
  it('picks the requested episode from a batch, not the largest file', () => {
    expect(pickVideoFile(emotionBatch, { episode: 1 })?.name).toContain('- 01')
    expect(pickVideoFile(emotionBatch, { episode: 3 })?.name).toContain('- 03')
  })
  it('falls back to the largest video when no episode is wanted or nothing matches', () => {
    expect(pickVideoFile(emotionBatch, undefined)?.name).toContain('- 04') // largest
    expect(pickVideoFile(emotionBatch, { episode: 9 })?.name).toContain('- 04') // no match -> largest
  })
  it('prefers an exact filename hint over parsing', () => {
    const hint = '[Emotion] Boku no Risou no Isekai Seikatsu - 02 (DVD 720x480 x264).mkv'
    expect(pickVideoFile(emotionBatch, { episode: 1, filename: hint })?.name).toBe(hint)
  })
  it('matches the filename hint against basenames (provider lists carry paths)', () => {
    const files = [
      { name: 'Pack/Show - 01.mkv', bytes: 1 },
      { name: 'Pack/Show - 02.mkv', bytes: 2 },
    ]
    expect(pickVideoFile(files, { filename: 'Show - 02.mkv' })?.name).toBe('Pack/Show - 02.mkv')
  })
  it('matches via absolute numbering when the seasonal episode number misses', () => {
    const files = [
      { name: 'Title - 27.mkv', bytes: 1 },
      { name: 'Title - 28.mkv', bytes: 2 },
    ]
    // Season entry episode 2 = absolute 28.
    expect(pickVideoFile(files, { episode: 2, abs: 28 })?.name).toBe('Title - 28.mkv')
  })
  it('respects the wanted season in multi-season packs', () => {
    const files = [
      { name: 'Show S01E04.mkv', bytes: 5 },
      { name: 'Show S02E04.mkv', bytes: 4 },
    ]
    expect(pickVideoFile(files, { episode: 4, season: 2 })?.name).toBe('Show S02E04.mkv')
  })
  it('never picks junk/extras even when they carry the episode number', () => {
    const files = [
      { name: 'Show - NCOP 01.mkv', bytes: 900 },
      { name: 'Show - 01 Preview.mkv', bytes: 800 },
      { name: 'Show - 01.mkv', bytes: 100 },
    ]
    expect(pickVideoFile(files, { episode: 1 })?.name).toBe('Show - 01.mkv')
  })
  it('a .5 recap cannot shadow the real episode', () => {
    const files = [
      { name: 'Show - 04.5.mkv', bytes: 900 },
      { name: 'Show - 04.mkv', bytes: 100 },
    ]
    expect(pickVideoFile(files, { episode: 4 })?.name).toBe('Show - 04.mkv')
  })
  it('falls back to a range file containing the wanted episode', () => {
    const files = [
      { name: 'Show - 01-04.mkv', bytes: 4000 },
      { name: 'Show - 05-08.mkv', bytes: 4000 },
    ]
    expect(pickVideoFile(files, { episode: 6 })?.name).toBe('Show - 05-08.mkv')
  })
  it('breaks exact-match ties by size (better quality duplicate)', () => {
    const files = [
      { name: 'Show - 02 (720p).mkv', bytes: 200 },
      { name: 'Show - 02 (1080p).mkv', bytes: 500 },
    ]
    expect(pickVideoFile(files, { episode: 2 })?.name).toBe('Show - 02 (1080p).mkv')
  })
  it('ignores non-video files', () => {
    const files = [
      { name: 'Show - 01.ass', bytes: 1e9 },
      { name: 'Show - 01.mkv', bytes: 100 },
    ]
    expect(pickVideoFile(files, { episode: 1 })?.name).toBe('Show - 01.mkv')
  })
  it('handles the movie/single-file case (no episode markers) via largest fallback', () => {
    const files = [{ name: 'Some Movie (2019) 1080p.mkv', bytes: 5e9 }]
    expect(pickVideoFile(files, { episode: 1 })?.name).toBe('Some Movie (2019) 1080p.mkv')
  })
})
