import { describe, it, expect } from 'vitest'
import { streamId, rankStreams, isUncached, parseSeasonEp, isWrongSeason, describe as parseStream } from './addon'

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
  it('keeps an unknown-parse file (never drop on uncertainty)', () =>
    expect(isWrongSeason({ name: '[RD⚡] Comet 1080p' } as any, want)).toBe(false))
})
