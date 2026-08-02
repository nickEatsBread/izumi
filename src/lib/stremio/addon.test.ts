import { describe, it, expect } from 'vitest'
import { streamId, rankStreams, isUncached, parseSeasonEp, isWrongSeason, describe as parseStream, rankInfos, pickBest } from './addon'

const s = (name: string, extra: Record<string, unknown> = {}) => ({ name, infoHash: 'h' + name, ...extra })

describe('addon', () => {
  it('builds a kitsu series stream id with episode', () => expect(streamId(11, 3)).toBe('kitsu:11:3'))
  it('omits episode when undefined (movie/OVA)', () => expect(streamId(11)).toBe('kitsu:11'))

  it('ranks higher resolution first', () => {
    const s = rankStreams([
      { url: 'a', name: 'Torrentio\n720p', title: 't' },
      { url: 'b', name: 'Torrentio\n1080p', title: 't' },
      { url: 'c', name: 'Torrentio\n4k', title: 't' },
    ] as any)
    expect(s.map((x) => x.url)).toEqual(['c', 'b', 'a'])
  })

  it('ranks cached above uncached regardless of quality', () => {
    const s = rankStreams([
      { url: 'a', name: '[RD⚡] Comet 1080p' },     // cached, lower res
      { url: 'b', name: '[RD⬇️] Comet 2160p' },     // uncached, higher res
    ] as any)
    expect(s.map((x) => x.url)).toEqual(['a', 'b'])
  })
})

describe('curated best release', () => {
  const HASH = 'a'.repeat(40)
  const opts = { seadexHashes: new Set([HASH]) }
  const row = (url: string, title: string, infoHash?: string) =>
    ({ url, infoHash, name: '[RD+] Addon', title }) as any

  it('leads its equally healthy neighbours in the default sort', () => {
    // A human compared these frame by frame; nothing scoreInfo reads off a filename is better
    // evidence than that, so within what the harder keys left tied the curated row goes first.
    const s = rankStreams([
      row('other', '[Group] Show - 01 (1080p) 👤 900'),
      row('curated', '[Other] Show - 01 (1080p) 👤 20', HASH),
    ], 'quality', opts)
    expect(s.map((x) => x.url)).toEqual(['curated', 'other'])
  })

  it('never outranks cache state', () => {
    const s = rankStreams([
      { url: 'uncached', infoHash: HASH, name: '[RD⬇️] Addon', title: 'Show - 01 (1080p) 👤 5' } as any,
      { url: 'cached', name: '[RD⚡] Addon', title: 'Show - 01 (720p) 👤 5' } as any,
    ], 'quality', opts)
    expect(s.map((x) => x.url)).toEqual(['cached', 'uncached'])
  })

  it('leads the list from a lower tier too, where the automatic pick would not', () => {
    // Deliberate, and the reason this is a key here rather than points: the list is a menu a human
    // is reading, every row states its resolution, and the row is badged. What must NOT cross a
    // tier is the pick made when nobody is looking — pickCandidates keeps the requested tier as a
    // hard key ABOVE this one, so choosing the 1080p instead stays one click away.
    const s = rankStreams([
      row('fhd', '[Group] Show - 01 (1080p) 👤 900'),
      row('curated', '[Other] Show - 01 (720p) 👤 20', HASH),
    ], 'quality', opts)
    expect(s.map((x) => x.url)).toEqual(['curated', 'fhd'])
  })

  it('leaves the literal sorts literal', () => {
    // Sorting by seeders answers a question the user asked in so many words. A curated row jumping
    // that list would answer a different one.
    const s = [
      row('other', '[Group] Show - 01 (1080p) 👤 900'),
      row('curated', '[Other] Show - 01 (1080p) 👤 20', HASH),
    ]
    expect(rankStreams(s, 'seeders', opts).map((x) => x.url)).toEqual(['other', 'curated'])
  })
})

describe('describe (Comet vs Torrentio parsing)', () => {
  it('parses a Comet stream (metadata in description, filename in behaviorHints)', () => {
    const info = parseStream({
      name: '[RD⚡] Comet 1080p',
      description: '📄 One Piece S01E1000 1080p WEB x264\n👤 152 💾 1.31 GB 🔎 Comet|Nyaa',
      behaviorHints: { filename: 'One Piece S01E1000 1080p WEB x264 SubsPlease', videoSize: 1406804553 },
      url: 'x',
    } as any)
    // The bug was: label came out as the bare "[RD⚡] Comet 1080p".
    expect(info.label).toBe('One Piece S01E1000 1080p WEB x264 SubsPlease')
    expect(info.filename).toBe('One Piece S01E1000 1080p WEB x264 SubsPlease')
    expect(info.seeders).toBe(152)
    expect(info.sizeLabel).toBe('1.31 GB')
    expect(info.quality).toBe(1080)
    expect(info.provider).toBe('RD')
    expect(info.cached).toBe('instant')
    expect(info.source).toBe('WEB')
    expect(info.codec).toBe('H264')
  })

  it('flags a Comet uncached (⬇️) stream, not instant', () => {
    const info = parseStream({ name: '[RD⬇️] Comet 1080p', url: 'x' } as any)
    expect(info.cached).toBe('uncached')
  })

  it('marks an uncached torrent with 0 seeders as dead', () => {
    const info = parseStream({ name: '[RD⬇️] Comet 1080p', description: '👤 0 💾 1 GB', url: 'x' } as any)
    expect(info.cached).toBe('down')
  })

  it('parses a Torrentio stream (metadata in title)', () => {
    const info = parseStream({
      name: '[RD+] Torrentio\n1080p',
      title: 'Rel.1080p.BluRay.x265-GRP\n👤 21 💾 984.22 MB ⚙️ MagnetDL',
      url: 'y',
    } as any)
    expect(info.label).toBe('Rel.1080p.BluRay.x265-GRP')
    expect(info.seeders).toBe(21)
    expect(info.sizeLabel).toBe('984.22 MB')
    expect(info.codec).toBe('HEVC')
    expect(info.source).toBe('BluRay')
    expect(info.cached).toBe('instant')
    expect(info.provider).toBe('RD')
  })

  it('surfaces rich badges (10bit / dual audio / HDR)', () => {
    const info = parseStream({
      name: '[RD⚡] Comet 2160p',
      behaviorHints: { filename: 'Show.S01E01.2160p.WEB-DL.HEVC.10bit.HDR.DUAL-AUDIO-GRP' },
      url: 'z',
    } as any)
    expect(info.badges).toContain('4K')
    expect(info.badges).toContain('HEVC')
    expect(info.badges).toContain('10bit')
    expect(info.badges).toContain('HDR')
    expect(info.badges).toContain('Dual Audio')
  })
})

describe('isUncached', () => {
  it('catches Torrentio "download" and Comet "⬇️"', () => {
    expect(isUncached({ name: '[RD download] Torrentio\n1080p' } as any)).toBe(true)
    expect(isUncached({ name: '[RD⬇️] Comet 1080p' } as any)).toBe(true)
    expect(isUncached({ name: '[RD⬇] Comet 1080p' } as any)).toBe(true) // no VS16
  })
  it('treats cached markers as not-uncached', () => {
    expect(isUncached({ name: '[RD+] Torrentio\n1080p' } as any)).toBe(false)
    expect(isUncached({ name: '[RD⚡] Comet 1080p' } as any)).toBe(false)
  })
})

describe('parseSeasonEp (wrong-season guard)', () => {
  it('reads SxxExx', () =>
    expect(parseSeasonEp({ behaviorHints: { filename: 'Re Zero S04E01 1080p WEB' } } as any)).toEqual({ season: 4, episode: 1 }))
  it('reads an absolute "- NN" number', () =>
    expect(parseSeasonEp({ behaviorHints: { filename: '[SubsPlease] Re Zero - 67 (1080p)' } } as any)).toEqual({ abs: 67 }))
  it('does not treat a resolution as an episode number', () =>
    expect(parseSeasonEp({ behaviorHints: { filename: 'Re Zero 1080p WEB x264' } } as any)).toEqual({}))
  it('reads a season-only batch (no episode)', () =>
    expect(parseSeasonEp({ behaviorHints: { filename: 'Tensei Slime S01 1080p BluRay' } } as any)).toEqual({ season: 1 }))
})

describe('cacheRank ordering', () => {
  it('orders instant < unknown < uncached < down', () => {
    const out = rankInfos([
      s('[RD download] A 👤 0'),   // down
      s('B'),                      // unknown
      s('[RD+] C'),                // instant
      s('[RD download] D 👤 5'),   // uncached
    ])
    expect(out.map((i) => i.cached)).toEqual(['instant', 'unknown', 'uncached', 'down'])
  })
})

describe('pickBest cache gating', () => {
  it('auto-plays a confirmed cached stream', () => {
    expect(pickBest([s('[RD+] A')], 'any', undefined, 'native')).toBeDefined()
  })
  it('auto-plays unknown when the provider cannot answer', () => {
    expect(pickBest([s('A')], 'any', undefined, 'none')).toBeDefined()
    expect(pickBest([s('A')], 'any', undefined, 'library')).toBeDefined()
  })
  it('refuses unknown when the provider CAN answer', () => {
    expect(pickBest([s('A')], 'any', undefined, 'native')).toBeUndefined()
  })
  it('never auto-plays a confirmed uncached stream', () => {
    expect(pickBest([s('[RD download] A 👤 5')], 'any', undefined, 'none')).toBeUndefined()
  })
})

describe('isWrongSeason (S4E1 must not play S1E1)', () => {
  const want = { season: 4, abs: 73 } // Tensei Slime 4th Season, episode 1 (AniZip ground truth)
  it('drops a S01 BluRay batch when the user is on season 4', () =>
    expect(isWrongSeason({ behaviorHints: { filename: 'Tensei Shitara Slime Datta Ken - S01E01 (BD 1080p) [Vodes]' } } as any, want)).toBe(true))
  it('keeps a correct S04E01 file', () =>
    expect(isWrongSeason({ behaviorHints: { filename: '[Judas] Tensei Shitara Slime Datta Ken - S04E01.mkv' } } as any, want)).toBe(false))
  it('keeps a correct absolute-73 file', () =>
    expect(isWrongSeason({ behaviorHints: { filename: '[SubsPlease] Tensei Slime - 73 (1080p)' } } as any, want)).toBe(false))
  it('drops a wrong absolute number', () =>
    expect(isWrongSeason({ behaviorHints: { filename: '[SubsPlease] Tensei Slime - 01 (1080p)' } } as any, want)).toBe(true))
  it('keeps everything when there is no ground truth', () =>
    expect(isWrongSeason({ behaviorHints: { filename: 'Whatever S01E01' } } as any, {})).toBe(false))
  it('drops an explicit S01E03 file when Episode 7 was requested', () =>
    expect(isWrongSeason(
      { behaviorHints: { filename: 'Season 1/Demon Slayer - S01E03 - Sabito And Makomo.mkv' } } as any,
      { season: 1, episode: 7 },
    )).toBe(true))
  it('drops an explicit dash-numbered Episode 3 when Episode 7 was requested', () =>
    expect(isWrongSeason(
      { behaviorHints: { filename: '[Group] Demon Slayer - 03 (1080p).mkv' } } as any,
      { episode: 7 },
    )).toBe(true))
  it('keeps a season batch whose filename does not claim a different episode', () =>
    expect(isWrongSeason(
      { behaviorHints: { filename: '[Trix] Demon Slayer S01 [BD 1080p AV1]' } } as any,
      { season: 1, episode: 7 },
    )).toBe(false))
  it('keeps an unknown-parse file (never drop on uncertainty)', () =>
    expect(isWrongSeason({ name: '[RD⚡] Comet 1080p' } as any, want)).toBe(false))
})
