import { describe, it, expect } from 'vitest'
import { relevant, likelyOtherProduction, isEpisodeExtra, isStandaloneMovie, wrongFranchiseSeason } from './relevance'
import type { Stream } from './parse'

const s = (filename: string): Stream => ({ behaviorHints: { filename } })

describe('isStandaloneMovie (year-less film sharing a series id — the Ghost in the Shell bug)', () => {
  it('flags a standalone film (no episode/batch marker)', () => {
    expect(isStandaloneMovie(s('GHOST IN THE SHELL 4KAV1 LOSELESS AC3 BLURAYRIP JIBBY'))).toBe(true)
    expect(isStandaloneMovie(s('Ghost in the Shell 4K2160.www.newpct1.com.mkv'))).toBe(true)
    expect(isStandaloneMovie(s('[Shiniori-Raws] Ghost In The Shell 2 Innocence (UHD-BD 4k 3840x1632 x265 Nvenc 10bit Dolby TrueHD)'))).toBe(true)
  })
  it('keeps a real series episode', () => {
    expect(isStandaloneMovie(s('[Reza] THE GHOST IN THE SHELL (2026) - S01E01.mkv'))).toBe(false)
    expect(isStandaloneMovie(s('[DKB] The Ghost in the Shell - S01E01 [1080p][HEVC x265 10bit]'))).toBe(false)
    expect(isStandaloneMovie(s('[SubsPlease] Dr Stone - 01 (1080p)'))).toBe(false) // absolute-numbered
  })
  it('keeps a season/complete pack', () => {
    expect(isStandaloneMovie(s('[Judas] One Piece (Complete Batch) [1080p]'))).toBe(false)
    expect(isStandaloneMovie(s('Attack on Titan S01 1080p BluRay'))).toBe(false)
  })
})

describe('relevant', () => {
  const hellMode = [
    'Hell Mode: Yarikomi-zuki no Gamer wa Haisettei no Isekai de Musou Suru 2nd Season',
    'HELL MODE: The Hardcore Gamer Dominates in Another World with Garbage Balancing Season 2',
  ]

  it('keeps a SHORT-title release of a long-titled anime (the "no sources" bug)', () => {
    // Release names the show "Hell Mode S2" — only 2 title tokens vs the 11–12-token
    // official titles. The old ratio (intersection / wantedTokens) was ~18% → dropped.
    expect(relevant(s('[SubsPlease] Hell Mode S2 - 01 (1080p) [92F98170].mkv'), hellMode)).toBe(true)
    expect(relevant(s('[SubsPlease] Hell Mode S2 - 01 (720p) [5DD75C35].mkv'), hellMode)).toBe(true)
  })

  it('keeps a full-title release', () => {
    expect(relevant(s('Hell Mode Yarikomi-zuki no Gamer wa Haisettei - 01 [1080p].mkv'), hellMode)).toBe(true)
  })

  it('drops an unrelated release sharing the same id', () => {
    expect(relevant(s('[Erai-raws] Some Other Anime - 05 [1080p][Multiple Subtitle].mkv'), hellMode)).toBe(false)
    expect(relevant(s('Naruto Shippuuden - 500 (1080p).mkv'), hellMode)).toBe(false)
  })

  it('keeps a nameless stream — never drops on true uncertainty', () => {
    expect(relevant({} as Stream, hellMode)).toBe(true)
  })

  it('short-title match works for a one-word title too', () => {
    expect(relevant(s('[Group] Frieren - 12 (1080p).mkv'), ['Sousou no Frieren', 'Frieren: Beyond Journey’s End'])).toBe(true)
  })

  it('keeps English Dr. Stone releases against a long official title (Russian-only bug)', () => {
    // AniList: "Dr. Stone: Science Future" (3 title tokens: stone/science/future).
    // Release groups omit the "Science Future" subtitle → the name carries only
    // "stone". Group tag + S04E25 must NOT dilute content, or these get dropped and
    // only Russian entries (which embed the full English title) survive.
    const drStone = ['Dr. Stone: Science Future', 'Dr. STONE: SCIENCE FUTURE', 'Dr. STONE: SCIENCE FUTURE Part 3']
    expect(relevant(s('[SubsPlease] Dr STONE S04E25 NF WEB-DL.mkv'), drStone)).toBe(true)
    expect(relevant(s('Dr Stone S4 - 25 (1080p).mkv'), drStone)).toBe(true)
    expect(relevant(s('Dr STONE - Science Future - S04E25 (WEB E).mkv'), drStone)).toBe(true)
    expect(relevant(s('Dr STONE S04E25 CR WEB-DL.mkv'), drStone)).toBe(true)
  })
})

describe('isEpisodeExtra (openings/endings/creditless clips indexed under an episode)', () => {
  it('drops a creditless OP that would win the 4K auto-pick (Death Note bug)', () => {
    expect(isEpisodeExtra(s('Death Note OP 2 [4K 60FPS Creditless].mp4'))).toBe(true)
  })
  it('drops NCOP/NCED/textless extras', () => {
    expect(isEpisodeExtra(s('[Judas] Death Note NCOP1 (BD 1080p).mkv'))).toBe(true)
    expect(isEpisodeExtra(s('Death Note - ED 3 [Textless].mkv'))).toBe(true)
  })
  it('keeps real episodes', () => {
    expect(isEpisodeExtra(s('[Erai-raws] Death Note - 37 [1080p][Multiple Subtitle][80A080A7].mkv'))).toBe(false)
    expect(isEpisodeExtra(s('Death.Note.S01E37.New.World.1080p.BluRay.DD+.2.0.x265-NAN0.mkv'))).toBe(false)
    expect(isEpisodeExtra(s('[SubsPlease] Naruto Shippuuden - 500 (1080p).mkv'))).toBe(false)
  })
})

describe('likelyOtherProduction (One Piece anime vs 2023 live action)', () => {
  it('drops the live action: SxxExx + a year newer than the anime debut', () => {
    expect(likelyOtherProduction(s('One.Piece.2023.S01E01.1080p.NF.WEB-DL.DDP5.1.x264-GROUP.mkv'), 1999)).toBe(true)
  })
  it('keeps the anime: absolute numbering, no SxxExx', () => {
    expect(likelyOtherProduction(s('[SubsPlease] One Piece - 1071 (1080p) [F00D].mkv'), 1999)).toBe(false)
  })
  it('keeps a year-less SxxExx release when the anime is NOT known absolute-numbered', () => {
    expect(likelyOtherProduction(s('One Piece S01E01 1080p.mkv'), 1999)).toBe(false)
  })
  it('drops a year-less SxxExx live action when the anime IS absolute-numbered (One Piece ep1 bug)', () => {
    // Long-running anime ship as "One Piece - 001"; a scene "S01E01" is the live action
    // even with no disambiguation year. `absoluteNumbered` = 3rd arg.
    expect(likelyOtherProduction(s('One Piece S01E01 1080p.mkv'), 1999, true)).toBe(true)
    expect(likelyOtherProduction(s('One.Piece.S01E01.2160p.NF.WEB-DL.mkv'), 1999, true)).toBe(true)
  })
  it('keeps an absolute-numbered release even for a long-runner (the real anime file)', () => {
    expect(likelyOtherProduction(s('[SubsPlease] One Piece - 001 (1080p).mkv'), 1999, true)).toBe(false)
  })
  it('keeps a legit SxxExx BD batch of a normal-length anime (not absolute-numbered)', () => {
    expect(likelyOtherProduction(s('Death.Note.S01E37.1080p.BluRay.x265.mkv'), 2006, false)).toBe(false)
  })
  it('no-op without a known anime year and not absolute-numbered', () => {
    expect(likelyOtherProduction(s('One.Piece.2023.S01E01.mkv'), undefined)).toBe(false)
  })
  // A shared kitsu id can pull an OLDER film into a newer series (the 1995 Ghost in the
  // Shell movie under the 2026 "Koukaku Kidoutai" series).
  it('drops an older same-title film polluting a newer series', () => {
    expect(likelyOtherProduction(s('Ghost in the Shell 1995 (UHD BD 1080p FLAC HDR10 x265).mkv'), 2026)).toBe(true)
    expect(likelyOtherProduction(s('GHOST IN THE SHELL 1995 4K HDR REMASTERED BluRay 1080p HEVC 10bit DTS.mkv'), 2026)).toBe(true)
  })
  it('keeps the real series episode of that newer series', () => {
    expect(likelyOtherProduction(s('[DKB] The Ghost in the Shell - S01E01 [1080p][HEVC x265 10bit].mkv'), 2026)).toBe(false)
  })
  it('never drops a plain absolute-numbered episode even with an off release year', () => {
    expect(likelyOtherProduction(s('[Erai-raws] Some Anime - 12 (2019) [1080p].mkv'), 2026)).toBe(false)
  })
})

describe('wrongFranchiseSeason (base-entry request pulling in a sequel season — the AoT S1 → Final Season bug)', () => {
  // Requesting the BASE entry: its titles name NO season.
  const aotS1 = ['Shingeki no Kyojin', 'Attack on Titan', '進撃の巨人']

  it('drops a "Final Season" file for a base-season request', () => {
    expect(wrongFranchiseSeason(s('[Moozzi2] Shingeki no Kyojin The Final Season - 01 [ 60 ] (BD 3840x2160 x265-10Bit Flac).mkv'), aotS1)).toBe(true)
    expect(wrongFranchiseSeason(s('[Neo-raws] Shingeki no Kyojin - The Final Season - 01 [2160p][Multiple Subtitle].mkv'), aotS1)).toBe(true)
  })

  it('drops numbered sequel seasons / parts for a base request', () => {
    expect(wrongFranchiseSeason(s('[Group] Shingeki no Kyojin Season 2 - 01 [1080p].mkv'), aotS1)).toBe(true)
    expect(wrongFranchiseSeason(s('Shingeki no Kyojin 3rd Season - 01 (1080p).mkv'), aotS1)).toBe(true)
    expect(wrongFranchiseSeason(s('Attack on Titan Season 3 Part 2 - 01.mkv'), aotS1)).toBe(true)
  })

  it('keeps genuine season-1 / absolute / batch releases for a base request', () => {
    expect(wrongFranchiseSeason(s('[Erai-raws] Shingeki no Kyojin - 01 [1080p].mkv'), aotS1)).toBe(false)
    expect(wrongFranchiseSeason(s('Shingeki no Kyojin S01 1080p BluRay.mkv'), aotS1)).toBe(false)
    expect(wrongFranchiseSeason(s('Shingeki no Kyojin Season 1 [BD 1080p].mkv'), aotS1)).toBe(false)
    expect(wrongFranchiseSeason(s('Attack on Titan Season 1-3 Complete BluRay.mkv'), aotS1)).toBe(false)
  })

  it('does NOT filter when the requested title itself names a season (so a Final Season request keeps its files)', () => {
    const aotFinal = ['Shingeki no Kyojin: The Final Season', 'Attack on Titan: Final Season']
    expect(wrongFranchiseSeason(s('[Neo-raws] Shingeki no Kyojin - The Final Season - 01 [2160p].mkv'), aotFinal)).toBe(false)
    const aotS3 = ['Shingeki no Kyojin Season 3', 'Attack on Titan Season 3']
    expect(wrongFranchiseSeason(s('Shingeki no Kyojin Season 3 - 05 [1080p].mkv'), aotS3)).toBe(false)
  })
})
