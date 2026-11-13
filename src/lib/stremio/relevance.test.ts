import { describe, it, expect } from 'vitest'
import {
  relevant,
  hasExplicitTitleConflict,
  likelyOtherProduction,
  isEpisodeExtra,
  isStandaloneMovie,
  namesOnlyTheTitle,
  selfDeclaredOtherProduction,
  wrongFranchiseSeason,
} from './relevance'
import type { Stream } from './parse'

const s = (filename: string): Stream => ({ behaviorHints: { filename } })

describe('hasExplicitTitleConflict (trusted source evidence)', () => {
  const poppyHill = ['Coquelicot-zaka kara', 'From Up on Poppy Hill']

  it('rejects a filename or canonical provider title that names another movie', () => {
    expect(hasExplicitTitleConflict(
      s('Castle.in.the.Sky.1986.1080p.BluRay.x265.mkv'), poppyHill,
    )).toBe(true)
    expect(hasExplicitTitleConflict({
      __stream: true,
      __sourceTitle: 'Castle in the Sky',
      behaviorHints: { filename: 'Direct HLS' },
    }, poppyHill)).toBe(true)
  })

  it('keeps matching, opaque, and transport-only trusted labels', () => {
    expect(hasExplicitTitleConflict(
      s('From.Up.on.Poppy.Hill.2011.1080p.BluRay.x265.mkv'), poppyHill,
    )).toBe(false)
    expect(hasExplicitTitleConflict(s('コクリコ坂から.mkv'), poppyHill)).toBe(false)
    expect(hasExplicitTitleConflict(s('Direct HLS · Server 1'), poppyHill)).toBe(false)
  })

  it('retains short franchise identity markers such as Z and GT', () => {
    expect(hasExplicitTitleConflict(
      s('Dragon.Ball.Z.S01E01.1080p.WEB.mkv'), ['Dragon Ball GT'],
    )).toBe(true)
    expect(hasExplicitTitleConflict(
      s('Dragon.Ball.GT.S01E01.1080p.WEB.mkv'), ['Dragon Ball GT'],
    )).toBe(false)
  })

  it('treats a readable short title as identity rather than opaque text', () => {
    expect(hasExplicitTitleConflict(s('Us'), ['Josee, the Tiger and the Fish'])).toBe(true)
    expect(hasExplicitTitleConflict(s('Us'), ['Us'])).toBe(false)
    expect(hasExplicitTitleConflict(s('映画.mkv'), ['Us'])).toBe(false)
  })

  it('keeps exact punctuation-separated short-letter titles', () => {
    expect(hasExplicitTitleConflict(s('M*A*S*H.1970.1080p.BluRay.mkv'), ['M*A*S*H'])).toBe(false)
    expect(hasExplicitTitleConflict(s('M*A*S*H.1970.1080p.BluRay.mkv'), ['S.W.A.T.'])).toBe(true)
  })

  it('keeps exact hyphenated and numeric title identities at release boundaries', () => {
    expect(hasExplicitTitleConflict(s('MI-5.S01E01.1080p.WEB.mkv'), ['MI-5'])).toBe(false)
    expect(hasExplicitTitleConflict(s('9-1-1.S01E01.1080p.WEB.mkv'), ['9-1-1'])).toBe(false)
    expect(hasExplicitTitleConflict(s('1917.2019.1080p.BluRay.mkv'), ['1917'])).toBe(false)
    expect(hasExplicitTitleConflict(s('MI-6.S01E01.1080p.WEB.mkv'), ['MI-5'])).toBe(true)
    expect(hasExplicitTitleConflict({ __sourceTitle: '1917' }, ['From Up on Poppy Hill'])).toBe(true)
  })

  it('accepts exact romanization spacing variants without accepting longer titles', () => {
    expect(hasExplicitTitleConflict(s('Dogulwang - 08 [1080p].mkv'), ['Dogul Wang'])).toBe(false)
    expect(hasExplicitTitleConflict({ __sourceTitle: 'Toukutsu Ou' }, ['Toukutsuou'])).toBe(false)
    expect(hasExplicitTitleConflict(s('Dogulwang End Line - 01 [1080p].mkv'), ['Dogul Wang'])).toBe(true)
  })
})

describe('relevant (a title that reduces to one distinct word)', () => {
  // AniList 2507: romaji "Tsuma Tsuma", english "Wife with Wife". Both collapse to a single
  // distinct content word, so "≥50% of the official title's tokens" was satisfied by ANY release
  // containing that one very common word — and a different show played.
  const wanted = ['Tsuma Tsuma', 'Wife with Wife', 'Tsuma Tsuma Hitoduma x Hitoduma']

  it('keeps the actual release', () => {
    expect(relevant(s('[SakuraCircle] Tsuma Tsuma - 01 (DVD 480p).mkv'), wanted)).toBe(true)
    expect(relevant(s('Tsuma Tsuma Hitoduma x Hitoduma 01 [720p].mkv'), wanted)).toBe(true)
  })

  it('rejects a different show that merely shares the one word', () => {
    expect(relevant(s('[Group] Tsuma no Haha Sayuri - 01.mkv'), wanted)).toBe(false)
    expect(relevant(s('Wife Swap Diaries - 01.mkv'), wanted)).toBe(false)
  })

  it('still keeps a single-word title matched by a release that is only that word', () => {
    expect(relevant(s('[Group] Bleach - 001 [1080p].mkv'), ['Bleach'])).toBe(true)
    expect(relevant(s('Bleach Blade Battlers - 01.mkv'), ['Bleach'])).toBe(false)
  })

  it('does not disturb ordinary multi-word matching', () => {
    expect(relevant(s('[SubsPlease] Dr STONE S04E25 NF WEB-DL.mkv'), ['Dr. Stone: Science Future'])).toBe(true)
  })
})

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
  it('keeps a markerless pack identified structurally by an extension', () => {
    expect(isStandaloneMovie({
      ...s('[smol] Masamune-kun no Revenge (BD 1080p HEVC Opus)'),
      __batch: true,
    })).toBe(false)
  })
  // Every name below is a real episode file the rule used to drop as a film.
  it.each([
    'Tensei Shitara Slime Datta Ken 01.mkv',
    '[Beatrice-Raws] Tensei Shitara Slime Datta Ken 01 [BDRip 1920x1080 HEVC FLAC]',
    'Pocket Monsters (2023) 145 (1080p) [C282D06B].mkv',
    'Spice and Wolf 13 1080p.mkv',
    '[Daemon Anime] Naruto Shippuden 1 [Akira].mkv',
    'One_Piece_020.mp4',
    '[Cleo]Tensei_shitara_Slime_Datta_Ken_-_01_(Dual Audio_10bit_BD1080p_x265).mkv',
    '[DB]_Naruto_Shippuuden_001-002_[75F021EA].avi',
    '[Exiled-Destiny]_Hunter_X_Hunter_2011_Ep01_(57F1E3A4).mkv',
    '[bonkai77].Sword.Art.Online.Episode.01.The.World.of.Swords.1080p.Dual.Audio.Bluray [D688CA7E].mkv',
    'Bakemonogatari.2009.TV.BDRIP.1080P.X264.FLAC.2AUDIO.[2.0CH].[EQ].[RE].EP01_CherryBoyz.mkv',
    'Mushoku Tensei - Jobless Reincarnation (2021) - S01E01v2 - Jobless Reincarnation [Bluray-1080p].mkv',
    'One Piece - E020 - Das Restaurant auf dem Meer.mp4',
    '[Studio GreenTea] Kusuriya no Hitorigoto [49][WebRip][HEVC-10bit 1080p AAC][JPTC].mp4',
    '[Doomdos] - The Exiled Heavy Knight Knows How to Game the System - 第14话 - [1080p BILIBILI COM WEB-DL].mkv',
    '01. Tensei shitara Slime Datta Ken (BDRip 1080p HEVC).mkv',
    'Horimiya.01.A.Tiny.Happenstance.1080p.x265.opus.2.0.mkv',
    'Naruto 001 Remaster (BDRip 1080p x264 AC3 Multi).mkv',
    'Sword.Art.Online.II.(01.serija).2014.x264.HDTVRip.1080p.mkv',
  ])('keeps an episode numbered the way release groups number it: %s', (name) => {
    expect(isStandaloneMovie(s(name))).toBe(false)
  })
  it('still flags films whose only numbers are a year, a sequel or technical tags', () => {
    expect(isStandaloneMovie(s('Kung Fu Panda 2 (2011).mkv'))).toBe(true)
    expect(isStandaloneMovie(s('Example Film 2.mkv'))).toBe(true)
    expect(isStandaloneMovie(s('Example Film 12 (2014) [1080p].mkv'))).toBe(true)
    expect(isStandaloneMovie(s('Ghost in the Shell (1995) [BDRip 1080p x264 AAC2.0].mkv'))).toBe(true)
    expect(isStandaloneMovie(s('Akira 1988 2160p UHD BluRay H.264 DDP5.1.mkv'))).toBe(true)
    expect(isStandaloneMovie(s('Ghost.in.the.Shell.1995.1080p.BluRay.H.264.AAC2.0.mkv'))).toBe(true)
    expect(isStandaloneMovie(s('[Group] Example Film [2026] [1080p].mkv'))).toBe(true)
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

  it('keeps scene-style releases that carry only the main title before a long subtitle', () => {
    // Web releases name a light-novel adaptation by its short main title, then append the episode
    // title, audio channels, a subtitle flag and a -Group suffix. None of that is title, so it must
    // not outvote the three title words the release does carry.
    const lender = [
      'Spell Lender: Kicked Out of the Guild, I Collect My Loans With a Fairy Partner',
      'Kashidashi Mahou wa Kyousei Kaishuu',
    ]
    expect(relevant(s('Spell.Lender.S01E01.Kicked.Out.1080p.CR.WEB-DL.JPN.AAC2.0.H.264.MSubs-Group.mkv'), lender)).toBe(true)
    expect(relevant(s('Spell.Lender.S01E02.Exile.1080p.BILI.WEB-DL.JPN.AAC2.0.H.265.MSubs-Group.mkv'), lender)).toBe(true)
    expect(relevant(s('Spell.Lender.S01E02.1080p.BILI.WEB-DL.AAC2.0.H.264-GRP.mkv'), lender)).toBe(true)
    expect(relevant(s('Spell Lender S01E02 SUBFRENCH 1080p CR WEB-DL AAC2.0 H.264-Some-Raws.mkv'), lender)).toBe(true)
    // The anchor still rejects a title run that adds or swaps words.
    expect(relevant(s('Spell.Lender.Returns.S01E01.1080p.CR.WEB-DL.AAC2.0.H.264-GRP.mkv'), lender)).toBe(false)
    expect(relevant(s('Spell.Breaker.S01E01.1080p.CR.WEB-DL.AAC2.0.H.264-GRP.mkv'), lender)).toBe(false)
  })

  it('rejects a different title that replaces the distinctive leading words', () => {
    const reZero = [
      'Re:Zero kara Hajimeru Isekai Seikatsu',
      'Re:ZERO -Starting Life in Another World-',
    ]
    expect(relevant(s('[UF+]Loner Life In Another World - 01 [BDrip 1080p].mkv'), reZero)).toBe(false)
    expect(relevant(s('Loner.Life.In.Another.World - 01 [BDrip 1080p].mkv'), reZero)).toBe(false)
  })

  it('still accepts an explicit unbracketed indexer hostname before the title', () => {
    expect(relevant(s('www.example.org - One Piece - 001 [1080p].mkv'), ['One Piece'])).toBe(true)
  })
})

describe('relevant (an ampersand written out)', () => {
  it('reads "&" and "and" as the same title', () => {
    const wanted = ['Example Dog & Fox', 'Rei to Kitsune (TV)', 'Rei & Kitsune']
    expect(relevant(s('[Group] Rei and Kitsune (2026) - S01E03 [WEB 1080p].mkv'), wanted)).toBe(true)
    expect(relevant(s('Example.Dog.and.Fox.S01E03.1080p.WEB-DL.mkv'), wanted)).toBe(true)
    expect(relevant(s('[Group] Example Cat and Fox - 03 (1080p).mkv'), wanted)).toBe(false)
  })
})

describe('relevant (romanized titles that break words differently)', () => {
  // The catalogue writes "... de wa Arimasen ga" while release groups write "... dewa Arimasen ga".
  // The glued word was one the request had never used, so the anchor filtered every romaji-titled
  // release out as a different title and only English-titled releases were left.
  const moonlit = [
    'Not Quite a Moonlit Villainess',
    'Tsukiyo no Akuyaku de wa Arimasen ga: Kouya Torikae Den',
  ]

  it('keeps releases that glue together words the catalogue keeps apart', () => {
    expect(relevant(s('[Group] Tsukiyo no Akuyaku dewa Arimasen ga - 01 (1080p) [0A1B2C3D].mkv'), moonlit)).toBe(true)
    expect(relevant(s('[Group] Tsukiyo no Akuyaku dewa Arimasen ga - S01E05 [1080p][HEVC x265 10bit][Multi-Subs].mkv'), moonlit)).toBe(true)
    expect(relevant(s('[Group] Tsukiyo no Akuyaku dewa Arimasen ga S01E05 (TVA 1080p HEVC AAC).mkv'), moonlit)).toBe(true)
    expect(relevant(s('[Group] Tsukiyo no Akuyaku dewa Arimasen ga- Kouya Torikae Den - 11 [1080p HEVC AAC].mkv'), moonlit)).toBe(true)
    expect(relevant(s('[Group] Tsukiyo no Akuyaku dewa Arimasen ga Kouya Torikae Den - 01v2 VOSTFR [WEB 1080p AAC].mkv'), moonlit)).toBe(true)
  })

  it('keeps releases that split a word the catalogue writes as one', () => {
    expect(relevant(s('[Group] Kaizoku Ou no Musume - 03 [1080p].mkv'), ['Kaizokuou no Musume'])).toBe(true)
    expect(relevant(s('Kaizoku.Ou.no.Musume.S01E03.1080p.WEB.mkv'), ['Kaizokuou no Musume'])).toBe(true)
  })

  it('still rejects a spin-off that only adds words to the re-spelled title', () => {
    expect(relevant(s('[Group] Tsukiyo no Akuyaku dewa Arimasen ga Gaiden - 01 (1080p).mkv'), moonlit)).toBe(false)
    expect(relevant(s('[Group] Kaizoku Ou no Musume Returns - 03 [1080p].mkv'), ['Kaizokuou no Musume'])).toBe(false)
  })

  it('only re-spells consecutive words of one requested title', () => {
    // "tsukiyoakuyaku" skips the "no" between the two words, so it is not a spelling of them.
    expect(relevant(s('[Group] Tsukiyoakuyaku Arimasen - 01 (1080p).mkv'), moonlit)).toBe(false)
  })
})

describe('relevant (a pack file named only by its episode)', () => {
  // Some season packs name every file by nothing but its episode: "Episode 01 - <episode title>.mkv".
  // The add-on's file name then carries no title at all while the release line above it, and the
  // folder the file sits in, do. Judged by the file name alone, the requested episode was filtered
  // out as a different title.
  const club = ['Kagerou Tanteidan wa Machigatteiru.', 'The Heat Haze Detective Club', 'Kagetan']
  const pack = '[Group] The Heat Haze Detective Club | S1 S2 OVAs | (BD 1080p x265) [Dual-Audio] | Kagerou Tanteidan wa Machigatteiru. | Zoku'
  const packFile = (path: string, release = pack): Stream => ({
    title: `${release}\n${path}\n👤 97 💾 574.56 MB`,
    behaviorHints: { filename: path.split('/').pop() },
  })
  const releaseFile = (release: string, filename: string): Stream => ({
    title: `${release}\n👤 12 💾 6.10 GB`,
    behaviorHints: { filename },
  })

  it('judges the file by the folder that places it in the requested season', () => {
    expect(relevant(packFile('S1 - The Heat Haze Detective Club/Episode 01 - And So, the Case Begins..mkv'), club)).toBe(true)
    expect(relevant(packFile(
      'Season 01/Episode 01 - And So, the Case Begins..mkv',
      '[Group] Kagerou Tanteidan wa Machigatteiru (Seasons 1-2 + OVAs) [BD 1080p] (Batch)',
    ), club)).toBe(true)
  })

  it('judges a file at the release root, or with no path shown, by the release line', () => {
    expect(relevant(packFile(
      'S01E01-And So, the Case Begins [0A1B2C3D].mkv',
      '[Group] The Heat Haze Detective Club (2013) (Season 1) [BDRip] [1080p Dual Audio HEVC]',
    ), club)).toBe(true)
    expect(relevant(releaseFile(
      '[Group] The Heat Haze Detective Club [BD 1080p] (Batch)',
      'Episode 01 - And So, the Case Begins..mkv',
    ), club)).toBe(true)
  })

  it('keeps rejecting the OVA, sequel-season and spin-off files of the same pack', () => {
    expect(relevant(packFile('OVAs/[Group] Kagetan - OVA - 01.mkv'), club)).toBe(false)
    expect(relevant(packFile('OVAs/Episode 01 - The Summer Festival Case.mkv'), club)).toBe(false)
    expect(relevant(packFile('S2 - The Heat Haze Detective Club TOO!/Episode 01 - Once Again, the Case Begins..mkv'), club)).toBe(false)
    expect(relevant(packFile('Season 2/Episode 01 - Once Again, the Case Begins..mkv'), club)).toBe(false)
    expect(relevant(packFile('S02E01 - Once Again, the Case Begins.mkv', '[Group] The Heat Haze Detective Club (Seasons 1-2) [BD]'), club)).toBe(false)
    expect(relevant(packFile('The Heat Haze Detective Club Gaiden/Episode 01 - A Side Case.mkv'), club)).toBe(false)
    // A sequel numbered after its title: the file carries the episode, so that number is the title's.
    expect(relevant(packFile('The Heat Haze Detective Club 2/Episode 01 - Once Again, the Case Begins..mkv'), club)).toBe(false)
    expect(relevant(releaseFile('[Group] The Heat Haze Detective Club 2 [BD 1080p]', 'Episode 01 - Once Again..mkv'), club)).toBe(false)
  })

  it('does not lend a release its title when the file could be any part of it', () => {
    // No path is shown, so an "Episode 01" of two seasons and their OVAs could be any of them.
    expect(relevant(releaseFile(
      '[Group] The Heat Haze Detective Club S1+S2+OVA [BD 1080p]',
      'Episode 01 - And So, the Case Begins..mkv',
    ), club)).toBe(false)
  })

  it('rejects a release line that names a sequel season or another title', () => {
    expect(relevant(releaseFile(
      '[Group] The Heat Haze Detective Club (2015) (Season 2) [BD 1080p]',
      'S02E01-Once Again, the Case Begins [0A1B2C3D].mkv',
    ), club)).toBe(false)
    expect(relevant(releaseFile('[Group] The Heat Haze Detective Club TOO! [BD 1080p]', 'Episode 01 - Once Again..mkv'), club)).toBe(false)
    expect(relevant(releaseFile('[Group] Some Other Show [BD 1080p]', 'Episode 01 - And So, the Case Begins..mkv'), club)).toBe(false)
  })

  it('serves a sequel request from the folder or release line that names the sequel', () => {
    const sequel = ['Kagerou Tanteidan wa Machigatteiru. Zoku', 'The Heat Haze Detective Club TOO!']
    expect(relevant(packFile('The Heat Haze Detective Club TOO!/Episode 01 - Once Again, the Case Begins..mkv'), sequel)).toBe(true)
    const numbered = ['Kagerou Tanteidan 2', 'The Heat Haze Detective Club 2']
    expect(relevant(packFile('The Heat Haze Detective Club 2/Episode 01 - Once Again, the Case Begins..mkv'), numbered)).toBe(true)
    // A range after the title counts episodes, it does not name a sequel.
    expect(relevant(releaseFile('[Group] The Heat Haze Detective Club 1-13 [BD 1080p]', 'Episode 01 - And So, the Case Begins..mkv'), club)).toBe(true)
    const second = ['Kagerou Tanteidan 2nd Season', 'The Heat Haze Detective Club Season 2']
    expect(relevant(packFile(
      'Season 2/Episode 01 - Once Again, the Case Begins..mkv',
      '[Group] The Heat Haze Detective Club (Seasons 1-2) [BD 1080p]',
    ), second)).toBe(true)
  })

  it('does not serve a season request from a part that never names that season', () => {
    // Nothing names the season of a root "Episode 01" in a two-season release, or of a folder that
    // only carries the base title: for a season-2 request that is most likely season 1's episode.
    const second = ['Kagerou Tanteidan 2nd Season', 'The Heat Haze Detective Club Season 2']
    expect(relevant(packFile(
      'Episode 01 - And So, the Case Begins..mkv',
      '[Group] The Heat Haze Detective Club (Seasons 1-2) [BD 1080p]',
    ), second)).toBe(false)
    expect(relevant(packFile('The Heat Haze Detective Club/Episode 01 - And So, the Case Begins..mkv'), second)).toBe(false)
  })

  it('reads a sequel\'s season from the number its own titles end with', () => {
    // A sequel is often titled without a season ("… Zoku", "… TOO!") and numbered only in a synonym.
    const sequel = ['Kagerou Tanteidan wa Machigatteiru. Zoku', 'The Heat Haze Detective Club TOO!', 'Kagetan 2']
    expect(relevant(packFile('S2 - The Heat Haze Detective Club TOO!/Episode 01 - Once Again, the Case Begins..mkv'), sequel)).toBe(true)
    expect(relevant(packFile('S1 - The Heat Haze Detective Club/Episode 01 - And So, the Case Begins..mkv'), sequel)).toBe(false)
    expect(relevant(packFile('Kagetan/Episode 01 - And So, the Case Begins..mkv'), sequel)).toBe(false)
    const roman = ['Kagerou Tanteidan II: Futatabi', 'The Heat Haze Detective Club II']
    expect(relevant(packFile('Season 2/Episode 01 - Once Again, the Case Begins..mkv', '[Group] The Heat Haze Detective Club (Seasons 1-2) [BD]'), roman)).toBe(true)
    expect(relevant(packFile('Season 1/Episode 01 - And So, the Case Begins..mkv', '[Group] The Heat Haze Detective Club (Seasons 1-2) [BD]'), roman)).toBe(false)
    // A title that ends in a number of its own is not a sequel.
    const numbered = ['Kaiju Tanteidan No. 8', 'Detective Club No. 8', 'Tanteidan #8', 'Detective Club N°8']
    expect(relevant(packFile('S01E01-The Case Begins [0A1B2C3D].mkv', '[Group] Detective Club No. 8 (2024) (Season 1) [BDRip]'), numbered)).toBe(true)
  })

  it('does not take the entry a sequel continues for the sequel', () => {
    const zero = ['The Heat Haze Detective Club 0', 'Kagerou Tanteidan 0']
    expect(relevant(packFile('S01E01 - And So, the Case Begins.mkv', '[Group] The Heat Haze Detective Club S01 (2013) [BluRay 1080p]'), zero)).toBe(false)
    expect(relevant(packFile('S01E01 - A New Case Begins.mkv', '[Group] The Heat Haze Detective Club 0 (2018) [BluRay 1080p]'), zero)).toBe(true)
  })

  it('needs an episode label the season verifier can read, not a bare leading number', () => {
    // "36 - 1.28.mkv" is episode 36 while "86 - 01.mkv" is episode 1 of a show called "86": a bare
    // leading number cannot say which, so such a file never borrows the release's title.
    expect(relevant(packFile(
      '01 - And So, the Case Begins.mkv',
      '[Group] The Heat Haze Detective Club (BD 720p)',
    ), club)).toBe(false)
  })
})

describe('relevant (a spin-off whose release name EXTENDS the requested title)', () => {
  // Long-running series have siblings whose names begin with the whole base title and then add a
  // subtitle. Rule (a) only measured how much of the REQUESTED title the release carries, so any
  // such release scored 100% and survived — then out-ranked the real (older, lower-seeded) episode
  // and auto-played. Episode 1 of the 1999 series played a 2024 side story instead.
  const onePiece = ['One Piece', 'One Piece', 'One Piece']

  it('keeps the main series episode', () => {
    expect(relevant(s('[SubsPlease] One Piece - 001 (1080p) [F00DBEEF].mkv'), onePiece)).toBe(true)
    expect(relevant(s('[Erai-raws] One Piece - 1071 [1080p][Multiple Subtitle][ENG][POR-BR][SPA-LA].mkv'), onePiece)).toBe(true)
    expect(relevant(s('One Piece - 001 [DVD 480p][Dual Audio].mkv'), onePiece)).toBe(true)
    expect(relevant(s('[Judas] One Piece (Complete Batch) [1080p].mkv'), onePiece)).toBe(true)
    // A dual-titled release: the alternate title sits in brackets, not in the release's own title.
    expect(relevant(s('[Group] One Piece (Wan Pisu) - 001 [1080p].mkv'), onePiece)).toBe(true)
    // An indexer that prefixes its own site name without bracketing it.
    expect(relevant(s('www.example.org - One Piece - 001 [1080p].mkv'), onePiece)).toBe(true)
  })

  it('drops the specials/side stories that merely start with the same words', () => {
    expect(relevant(s('[SubsPlease] One Piece Fan Letter - 01 (1080p) [ABCD1234].mkv'), onePiece)).toBe(false)
    expect(relevant(s('[Erai-raws] One Piece Fan Letter - 01 [1080p][Multiple Subtitle].mkv'), onePiece)).toBe(false)
    expect(relevant(s('One Piece Episode of Luffy - 01 [1080p].mkv'), onePiece)).toBe(false)
    expect(relevant(s('[Judas] One Piece Heart of Gold - 01 (BD 1080p).mkv'), onePiece)).toBe(false)
    expect(relevant(s('One Piece Adventure of Nebulandia - 01 [720p].mkv'), onePiece)).toBe(false)
  })

  it('keeps the spin-off for a request that IS the spin-off', () => {
    const fanLetter = ['One Piece Fan Letter', 'One Piece Fan Letter', 'One Piece Fan Letter']
    expect(relevant(s('[SubsPlease] One Piece Fan Letter - 01 (1080p) [ABCD1234].mkv'), fanLetter)).toBe(true)
    expect(relevant(s('One Piece Fan Letter - 01 [1080p].mkv'), fanLetter)).toBe(true)
  })

  it('drops the arc spin-offs of a long-running detective series', () => {
    const conan = ['Meitantei Conan', 'Detective Conan', 'Case Closed']
    expect(relevant(s('[Group] Detective Conan - 1120 [1080p].mkv'), conan)).toBe(true)
    expect(relevant(s('[Judas] Meitantei Conan - 0995 (1080p) [DEADBEEF].mkv'), conan)).toBe(true)
    expect(relevant(s('[Group] Detective Conan The Culprit Hanzawa - 01 [1080p].mkv'), conan)).toBe(false)
    expect(relevant(s('Meitantei Conan Zero no Tea Time - 01 (1080p).mkv'), conan)).toBe(false)
    expect(relevant(s('[Group] Detective Conan Police Academy Arc Wild Police Story - 01.mkv'), conan)).toBe(false)
  })

  it('drops the sibling entries of a long-running shounen franchise', () => {
    const dbSuper = ['Dragon Ball Super', 'Dragon Ball Super', 'Dragon Ball Super']
    expect(relevant(s('[Group] Dragon Ball Super - 131 [1080p][Multiple Subtitle].mkv'), dbSuper)).toBe(true)
    expect(relevant(s('Dragon Ball Super - 001 (1080p) [BAADF00D].mkv'), dbSuper)).toBe(true)
    expect(relevant(s('[Group] Dragon Ball Super Super Hero - 01 [1080p].mkv'), dbSuper)).toBe(false)
    expect(relevant(s('Dragon Ball Super Broly - 01 (BD 1080p).mkv'), dbSuper)).toBe(false)
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
  it('keeps a long-runner web release numbered past any live-action season', () => {
    expect(likelyOtherProduction(s('Example-chan.S01E81.1080p.AMZN.WEB-DL.JPN.DDP2.0.H.264-Group.mkv'), 2025, true)).toBe(false)
    expect(likelyOtherProduction(s('Example.Show.S01E31.1080p.WEB-DL.mkv'), 2020, true)).toBe(false)
    expect(likelyOtherProduction(s('Example.Show.S01E30.1080p.WEB-DL.mkv'), 2020, true)).toBe(true)
  })
  it('keeps a season-local SxxExx of a long sequel season whose titles name that season', () => {
    const sequel = ['Example Shark Season 2', 'Little Example Shark Season 2']
    expect(likelyOtherProduction(s('Example.Shark.S02E05.1080p.WEB-DL.mkv'), 2025, true, sequel)).toBe(false)
    expect(likelyOtherProduction(s('Example Shark 2nd Season S01E05 1080p.mkv'), 2025, true, ['Example Shark 2nd Season'])).toBe(false)
  })
  it('still drops an SxxExx under the base entry of a long-runner', () => {
    const base = ['Example Pirate', 'EXAMPLE PIRATE']
    expect(likelyOtherProduction(s('Example Pirate S01E01 1080p.mkv'), 1999, true, base)).toBe(true)
    expect(likelyOtherProduction(s('Example.Pirate.S02E03.1080p.WEB-DL.mkv'), 1999, true, base)).toBe(true)
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

describe('selfDeclaredOtherProduction', () => {
  it('drops a release whose own wording disclaims the production', () => {
    expect(selfDeclaredOtherProduction(s('Example Film 2026 (NOT the Famous Director FILM) 1080p WEB-DL HEVC x265 5.1 GROUP.mkv'))).toBe(true)
    expect(selfDeclaredOtherProduction(s('Example Film 2026 NOT the Famous Director FILM 1080p WEB-DL HEVC x265 5 1-GROUP.mkv'))).toBe(true)
    expect(selfDeclaredOtherProduction(s('Some Show [not a remaster] 1080p.mkv'))).toBe(true)
  })
  it('keeps ordinary notes and titles containing the word not', () => {
    expect(selfDeclaredOtherProduction(s('Example Film 2026 1080p (subs not the best).mkv'))).toBe(false)
    expect(selfDeclaredOtherProduction(s('Not Okay 2022 1080p WEB-DL.mkv'))).toBe(false)
  })
})

describe('isEpisodeExtra (scene trailer packs)', () => {
  it('drops tlr/tsr trailer and teaser files, including underscore-separated names', () => {
    expect(isEpisodeExtra(s('TheOdyssey_IMAX_TLR-2_3840x2024_HEVC_10bit_DTS-HD-MA_AC3_51.mkv'))).toBe(true)
    expect(isEpisodeExtra(s('Example.Film.2026.TSR1.2160p.WEB-DL.mkv'))).toBe(true)
  })
  it('keeps a feature whose group or title merely contains those letters', () => {
    expect(isEpisodeExtra(s('Example.Film.2026.2160p.WEB-DL-TLRGROUP.mkv'))).toBe(false)
    expect(isEpisodeExtra(s('Settlers.2026.1080p.WEB-DL.mkv'))).toBe(false)
  })
})

describe('isEpisodeExtra (trailer labels in other scripts)', () => {
  it('drops a trailer labelled in Cyrillic or Spanish', () => {
    expect(isEpisodeExtra(s('Пример / Example [2026, ProRes encode] Трейлер #2 (4K).mkv'))).toBe(true)
    expect(isEpisodeExtra(s('Example.2026.Trailer.Oficial.mkv'))).toBe(true)
    expect(isEpisodeExtra(s('Example 2026 Tráiler 1080p.mkv'))).toBe(true)
    expect(isEpisodeExtra(s('Пример / Example [2026, WEB-DL 1080p].mkv'))).toBe(false)
  })
})

// Shapes found by running the filter over real rows for 2,500+ titles. Release names here are made up
// around each show's own title; only the title wording matters to the rule under test.
describe('release names the title test misread', () => {
  const deathNote = ['DEATH NOTE', 'Death Note']
  const bisque = ['Sono Bisque Doll wa Koi wo Suru', 'My Dress-Up Darling']
  const bebop = ['Cowboy Bebop']
  const reZero = ['Re:Zero kara Hajimeru Isekai Seikatsu', 'Re:ZERO -Starting Life in Another World-']

  it('reads underscores as word breaks and a glued or dotted episode label as one', () => {
    expect(relevant(s('[Group]_Death_Note_Ep01_(1A2B3C4D).mkv'), deathNote)).toBe(true)
    expect(relevant(s('[Group]_Death_Note_EP01v2_[1A2B3C4D].avi'), deathNote)).toBe(true)
    expect(relevant(s('[Group] Death Note Ep. 01 - Example Episode Title.mkv'), deathNote)).toBe(true)
  })
  it('accepts either spelling of a romanized particle', () => {
    expect(relevant(s('[Group] Sono Bisque Doll wa Koi o Suru - 01 [1080p].mkv'), bisque)).toBe(true)
  })
  it('ends the title at a spelled-out season, a TV label or a split-episode number', () => {
    expect(relevant(s('Cowboy Bebop Season 1 Episode 1 Example Episode Title.mkv'), bebop)).toBe(true)
    expect(relevant(s('Cowboy Bebop TV 01 [1080p].mkv'), bebop)).toBe(true)
    expect(relevant(s('[Group] Re Zero kara Hajimeru Isekai Seikatsu - 01A [720p].mkv'), reZero)).toBe(true)
  })
  it('still rejects a different title written the same ways', () => {
    expect(relevant(s('[Group]_Death_Note_Relight_Ep01_(1A2B3C4D).mkv'), deathNote)).toBe(false)
    expect(relevant(s('[Group] Sono Bisque Doll wa Koi o Shinai - 01 [1080p].mkv'), bisque)).toBe(false)
    expect(relevant(s('Space Cowboy Bebop Season 1 Episode 1.mkv'), bebop)).toBe(false)
  })
})

describe('a tracker or extension row names a whole release, not a file', () => {
  const release = (title: string): Stream => ({
    behaviorHints: { filename: title }, __origin: { kind: 'torrent-extension', id: 'tracker:feed.test', name: 'Feed' },
  } as Stream)
  it('reads a series release with no episode label as its batch unless it names a film', () => {
    expect(isStandaloneMovie(release('[Group] Toradora! (2008) + OVA [BluRay 1080p]'))).toBe(false)
    expect(isStandaloneMovie(release('[Group] Darling in the Franxx [BD 1080p]'))).toBe(false)
    expect(isStandaloneMovie(release('[Group] Gekijouban Clannad [BD 1080p]'))).toBe(true)
    expect(isStandaloneMovie(release('[Group] Example Show Movie: Example Subtitle [1080p]'))).toBe(true)
    expect(isStandaloneMovie(s('Example Show [BD 1080p].mkv'))).toBe(true)
  })
})

describe('wrongFranchiseSeason for an entry titled with its sequel number', () => {
  const mob3 = ['Mob Psycho 100 III']
  const goblin2 = ['Goblin Slayer II', 'GOBLIN SLAYER II']
  const grace2 = ['Kamitachi ni Hirowareta Otoko 2', 'By the Grace of the Gods Season 2']
  it('keeps the season its own number names', () => {
    expect(wrongFranchiseSeason(s('[Group] Mob Psycho 100 III (Season 3) [1080p]'), mob3)).toBe(false)
    expect(wrongFranchiseSeason(s('[Group] Goblin Slayer Season 2 (BD 1080p) | Goblin Slayer II'), goblin2)).toBe(false)
    expect(wrongFranchiseSeason(s('[Group] Goblin Slayer (2023) (2nd Season) [1080p]'), goblin2)).toBe(false)
    expect(wrongFranchiseSeason(s('[Group] By the Grace of the Gods S02E07 [1080p]'), grace2)).toBe(false)
  })
  it('still rejects a different season of the same franchise', () => {
    expect(wrongFranchiseSeason(s('[Group] Mob Psycho 100 Season 2 - 01 [1080p]'), mob3)).toBe(true)
    expect(wrongFranchiseSeason(s('[Group] Goblin Slayer Season 3 - 01 [1080p]'), goblin2)).toBe(true)
  })
})

describe('isEpisodeExtra for an opening and ending pack', () => {
  it('reads OP.ED / OP&ED as the pack of credits it is', () => {
    expect(isEpisodeExtra(s('Example Show [OP.ED][BDRemux]'))).toBe(true)
    expect(isEpisodeExtra(s('[Group] Example Show OP&ED (BD 1080p)'))).toBe(true)
    expect(isEpisodeExtra(s('[Group] Example Show - 01 (1080p)'))).toBe(false)
  })
})

describe('release names that are not file names', () => {
  it('reads a series release named only by its title as that title, and a film rip as more', () => {
    const jan = ['Tetsunabe no Jan!', 'Iron Wok Jan!']
    expect(namesOnlyTheTitle(s('Tetsunabe no Jan!'), jan)).toBe(true)
    expect(namesOnlyTheTitle(s('[Group] Tetsunabe no Jan! RUS'), jan)).toBe(true)
    expect(namesOnlyTheTitle(s('Ghost in the Shell 2160p BluRay Rip'), ['The Ghost in the Shell', 'Ghost in the Shell'])).toBe(false)
    expect(namesOnlyTheTitle(s('[Group] Ghost In The Shell 2 Innocence (UHD-BD 4k)'), ['Ghost in the Shell'])).toBe(false)
  })
  it('reads a language tag after the title as release detail', () => {
    expect(relevant(s('Tetsunabe no Jan! RUS'), ['Tetsunabe no Jan!', 'Iron Wok Jan!'])).toBe(true)
    expect(relevant(s('[Group] Tetsunabe no Jan! - 05 [ITA] [1080p]'), ['Tetsunabe no Jan!', 'Iron Wok Jan!'])).toBe(true)
  })
})

describe('a sequel release that spells its season', () => {
  it('belongs to the entry titled with that sequel', () => {
    expect(relevant(s('[S02 E01] Overlord Season 2 Episode 01 Example Episode Title.mkv'), ['Overlord II'])).toBe(true)
    expect(relevant(s('[Group] Dr. STONE (Season 2) - 01 [1080p].mkv'), ['Dr. STONE: STONE WARS'])).toBe(true)
    expect(wrongFranchiseSeason(s('Overlord Season 2 Episode 01.mkv'), ['Overlord III'])).toBe(true)
  })
})

describe('a sequel number written right after the title', () => {
  const konosuba = ['Kono Subarashii Sekai ni Shukufuku wo!', "KONOSUBA -God's blessing on this wonderful world!"]
  const konosuba2 = ['Kono Subarashii Sekai ni Shukufuku wo! 2', "KONOSUBA -God's blessing on this wonderful world! 2"]
  it('names another entry unless the request is that entry', () => {
    expect(relevant(s('[Group] Kono Subarashii Sekai ni Shukufuku o! 2 01 [720p].mkv'), konosuba)).toBe(false)
    expect(relevant(s('[Group] Kono Subarashii Sekai ni Shukufuku o! 2 01 [720p].mkv'), konosuba2)).toBe(true)
    expect(relevant(s('[Group] Kaiju No. 8 01 [1080p].mkv'), ['Kaiju No. 8'])).toBe(true)
    expect(relevant(s('[Group] Bleach 12 [720p].mkv'), ['BLEACH', 'Bleach'])).toBe(true)
    // A year after the number is the release year, not an episode.
    expect(relevant(s('Oregairu 2 2015 S00E02 [1080p].mkv'), ['Oregairu Zoku OVA', 'Oregairu'])).toBe(true)
  })
  it('reads "TV-3" as the third season', () => {
    expect(wrongFranchiseSeason(s('[Group] KonoSuba TV-3 - 01 [1080p].mkv'), konosuba)).toBe(true)
    expect(wrongFranchiseSeason(s('Example Show TV-2 - 01.mkv'), ['Example Show 2'])).toBe(false)
    expect(wrongFranchiseSeason(s('[Group] Example Show [TV24+SP5] [BD 1080p]'), ['Example Show'])).toBe(false)
  })
})

describe('releases the remaining audit rejections were wrong about', () => {
  it('matches a release named in the native script by the native title', () => {
    expect(relevant(s('[Group] ガチアクタ #01 [1080p].mkv'), ['Gachiakuta', 'ガチアクタ'])).toBe(true)
    expect(relevant(s('[Group] 影宅 - 01 [WEB-DL][1080p].mkv'), ['Shadows House', '影宅'])).toBe(true)
    expect(relevant(s('[Group] 別の番組 - 01 [1080p].mkv'), ['Shadows House', '影宅'])).toBe(false)
  })
  it('reads a "Part N" cour label as release detail', () => {
    expect(relevant(s('[Group] Mushoku Tensei - Part 1 - 01 [BDRip 1080p].mkv'), ['Mushoku Tensei: Isekai Ittara Honki Dasu', 'Mushoku Tensei: Jobless Reincarnation'])).toBe(true)
  })
})

describe('native titles and credit packs, second pass', () => {
  it('does not take a native title followed by a sequel marker, or a Latin title that adds a word', () => {
    expect(relevant(s('[Group] 幼女戦記II / Youjo Senki II [01-12][WebRip 1080p]'), ['Youjo Senki', 'Saga of Tanya the Evil', '幼女戦記'])).toBe(false)
    expect(relevant(s('[Group][魔道祖师 第二季][1080p]'), ['Modao Zushi', '魔道祖师'])).toBe(false)
    expect(relevant(s('[Group] Example Saga BURST / 例のサーガ BURST [1080p]'), ['Example Saga', '例のサーガ'])).toBe(false)
  })
  it('reads OP/ED in an episode name as its subtitle styling, not a credits pack', () => {
    expect(isEpisodeExtra(s('[Group] Example Show (2023) - 01v2 (OP-ED Karaoke) [1080p].mkv'))).toBe(false)
    expect(isEpisodeExtra(s('[Group] Example Show 1-7+OP&ED+Special DVD'))).toBe(false)
    expect(isEpisodeExtra(s('Example Show - S1+S2 [OP.ED][BD]'))).toBe(true)
  })
})

describe('spellings the labelled audit sample still rejected', () => {
  it('folds romanized long vowels', () => {
    expect(relevant(s('[Group] Sayounara Ryuusei, Konnichiwa Jinsei - 01 [1080p].mkv'), ['Sayonara Ryuusei, Konnichiwa Jinsei'])).toBe(true)
    expect(relevant(s('[Group] Shokugeki No Soma - S05E01.mkv'), ['Shokugeki no Souma: Gou no Sara', 'Food Wars! The Fifth Plate'])).toBe(true)
  })
  it('reads a scene code glued to the title and a multiplication sign as x', () => {
    expect(relevant(s('Fire.ForceS01EP05.1080p.WEB.mkv'), ['Enen no Shouboutai', 'Fire Force'])).toBe(true)
    expect(relevant(s('High School D×D - 03x01 - Example Episode Title.mkv'), ['High School DxD BorN', 'High School DxD'])).toBe(true)
  })
  it('reads a number before a language tag as the episode', () => {
    expect(isStandaloneMovie(s('Code Geass Lelouch of the Rebellion 05 RUS.mkv'))).toBe(false)
    expect(isStandaloneMovie(s('Angel Beats! 3 Ger-Eng 720p.mkv'))).toBe(false)
  })
})

describe('regressions the folding pass caught in its own A/B run', () => {
  it('keeps a short title that looks like a language tag once folded', () => {
    expect(relevant(s('[Group] Free! (Dub) - 01 [1080p].mkv'), ['Free!', 'Free! - Iwatobi Swim Club'])).toBe(true)
    expect(relevant(s('Free! - S02E01.mkv'), ['Free!: Eternal Summer', 'Free! - Eternal Summer'])).toBe(true)
  })
  it('keeps titles glued together, with or without their "x"', () => {
    expect(relevant(s('HunterHunter.11_005.mkv'), ['HUNTER×HUNTER (2011)', 'Hunter x Hunter (2011)'])).toBe(true)
    expect(relevant(s('[Group] Maou2099 - 01.mkv'), ['Maou 2099', 'Demon Lord 2099'])).toBe(true)
  })
  it('reads "Title 9 - 12" as a range of episodes, not a sequel', () => {
    expect(relevant(s('[Group] Black Lagoon 9 - 12 [1080p]'), ['Black Lagoon'])).toBe(true)
  })
})

describe('volume and season-revision labels after the title', () => {
  const bisque = ['Sono Bisque Doll wa Koi wo Suru', 'My Dress-Up Darling']
  it('ends the title at "Vol 01", a bare "E01" and "S01v2"', () => {
    expect(relevant(s('[Group] Sono Bisque Doll wa Koi o Suru Vol 01 E01 [1080p].mkv'), bisque)).toBe(true)
    expect(relevant(s('[Group] My Dress-Up Darling - S01v2 (BD 1080p HEVC) [Dual Audio]'), bisque)).toBe(true)
  })
})

describe('regressions the final audit run caught', () => {
  it('keeps short and tag-titled releases the earlier rules kept', () => {
    expect(relevant(s('K-ON! 2009 - URA-ON! 01-03 .mkv'), ['K-ON!: Ura-On!', 'K-ON!: Ura-ON!!'])).toBe(true)
    expect(relevant(s('[Group] X TV Series (2001) - 01v2 [1A2B3C4D].mkv'), ['X (TV)', 'X'])).toBe(true)
    expect(relevant(s('[Group] 佐佐木與文鳥小嗶 Season 2 - 01 [1080P][WEB-DL].mp4'), ['Sasaki to Pii-chan Season 2', 'Sasaki and Peeps Season 2'])).toBe(true)
  })
})

describe('a franchise film is not its series', () => {
  it('rejects the series episodes a film request pulls in', () => {
    const film = ['NARUTO: Dai Gekitotsu! Maboroshi no Chitei Iseki Dattebayo!', 'Naruto the Movie: Legend of the Stone of Gelel']
    expect(relevant(s('Naruto -  182 1080p BluRay x265-Group.mkv'), film)).toBe(false)
  })
})

describe('a title written with "×"', () => {
  it('matches the release that drops the sign as well as one that spells it', () => {
    expect(relevant(s('[Group] Kakegurui - S02 - 01 [1080p].mkv'), ['Kakegurui ××', 'Kakegurui xx'])).toBe(true)
    expect(relevant(s('[Group] Hunter x Hunter (2011) - 05 [1080p].mkv'), ['HUNTER×HUNTER (2011)'])).toBe(true)
  })
})
