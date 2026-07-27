import { describe as suite, it, expect } from 'vitest'
import { describe, parseSeasonEp, isNotice } from './parse'

// Field-extraction coverage over shapes real addons and anime indexers actually emit. Each case
// here is a signal something downstream consumes: a missing size ties the size sort, a missing
// language lets a foreign source be auto-selected, a missing episode number defeats the season
// gate.

const bh = (filename: string, videoSize?: number) => ({ behaviorHints: { filename, videoSize } })

suite('size', () => {
  it('reads bytes from behaviorHints when present', () => {
    expect(describe({ url: 'u', ...bh('Show 01.mkv', 1_406_804_553) }).sizeBytes).toBe(1_406_804_553)
  })

  it('recovers bytes from the size written in the title', () => {
    // Without this, "sort by size" ties at 0 for every addon that reports size as text only —
    // which is most of them; only behaviorHints.videoSize was ever read.
    const info = describe({ url: 'u', title: 'Show - 01\n👤 21 💾 1.31 GB' })
    expect(info.sizeBytes).toBeCloseTo(1.31 * 1024 ** 3, -6)
  })

  it('reads binary and decimal spellings the same way', () => {
    const gib = describe({ url: 'a', title: '💾 1 GiB' }).sizeBytes
    const gb = describe({ url: 'b', title: '💾 1 GB' }).sizeBytes
    expect(gib).toBe(gb)
  })

  it('handles megabytes and terabytes', () => {
    expect(describe({ url: 'a', title: '💾 984.22 MB' }).sizeBytes).toBeCloseTo(984.22 * 1024 ** 2, -3)
    expect(describe({ url: 'b', title: '💾 1.5 TB' }).sizeBytes).toBeCloseTo(1.5 * 1024 ** 4, -9)
  })

  it('keeps the addon wording for the label', () => {
    expect(describe({ url: 'u', title: '💾 1.31 GB' }).sizeLabel).toBe('1.31 GB')
  })

  it('prefers the structured byte count over the text when both exist', () => {
    const info = describe({ url: 'u', title: '💾 1.31 GB', ...bh('Show 01.mkv', 999) })
    expect(info.sizeBytes).toBe(999)
  })
})

suite('seeders', () => {
  it('reads the person glyph', () => {
    expect(describe({ url: 'u', title: '👤 152' }).seeders).toBe(152)
  })
  it('reads the people glyph some indexers use instead', () => {
    expect(describe({ url: 'u', title: '👥 40' }).seeders).toBe(40)
  })
  it('reads a written seeders label', () => {
    expect(describe({ url: 'u', description: 'Seeders: 12' }).seeders).toBe(12)
    expect(describe({ url: 'u', description: 'S:7 | L:2' }).seeders).toBe(7)
  })
  it('does not mistake the leechers count for seeders', () => {
    expect(describe({ url: 'u', description: 'L:99' }).seeders).toBeUndefined()
  })
})

suite('hdr', () => {
  it('badges plain HDR10', () => {
    // HDR10 matched the HDR10+ branch's prefix test and then fell through to nothing.
    expect(describe({ url: 'u', ...bh('Show.01.2160p.HDR10.mkv') }).hdr).toBe('HDR10')
  })
  it('badges HDR10+', () => {
    expect(describe({ url: 'u', ...bh('Show.01.2160p.HDR10+.mkv') }).hdr).toBe('HDR10+')
  })
  it('prefers the combined Dolby Vision form', () => {
    expect(describe({ url: 'u', ...bh('Show.01.2160p.DV.HDR10.mkv') }).hdr).toBe('DV')
  })
  it('badges bare HDR', () => {
    expect(describe({ url: 'u', ...bh('Show.01.2160p.HDR.mkv') }).hdr).toBe('HDR')
  })
})

suite('batch detection', () => {
  it('flags an explicit batch', () => {
    expect(describe({ url: 'u', ...bh('[Group] Show (01-24) [Batch]') }).batch).toBe(true)
  })
  it('flags a bare season pack', () => {
    expect(describe({ url: 'u', ...bh('Show S01 1080p BluRay') }).batch).toBe(true)
  })
  it('flags an episode range', () => {
    expect(describe({ url: 'u', ...bh('[Group] Show - 01-12 (1080p)') }).batch).toBe(true)
  })
  it('flags a volume set', () => {
    expect(describe({ url: 'u', ...bh('Show Vol.2 BD 1080p') }).batch).toBe(true)
  })
  it('does not flag a single episode', () => {
    expect(describe({ url: 'u', ...bh('[Group] Show - 07 (1080p)') }).batch).toBe(false)
    expect(describe({ url: 'u', ...bh('Show S01E07 1080p') }).batch).toBe(false)
  })
})

suite('audio languages', () => {
  it('reads a dual-audio release as carrying both', () => {
    const info = describe({ url: 'u', ...bh('[Group] Show - 01 (1080p) [Dual Audio]') })
    expect(info.dualAudio).toBe(true)
  })
  it('detects an explicit language token', () => {
    expect(describe({ url: 'u', ...bh('Show.01.1080p.ITA.mkv') }).audioLanguages).toContain('ita')
  })
  it('detects a spelled-out language', () => {
    expect(describe({ url: 'u', ...bh('Show.01.1080p.Italian.mkv') }).audioLanguages).toContain('ita')
  })
  it('reads multi-audio as multi rather than a single language', () => {
    expect(describe({ url: 'u', ...bh('Show.01.1080p.MULTi.mkv') }).audioLanguages).toContain('multi')
  })
  it('claims no language when the name says nothing', () => {
    expect(describe({ url: 'u', ...bh('[Group] Show - 01 (1080p).mkv') }).audioLanguages).toEqual([])
  })
  it('does not read a release group as a language', () => {
    // "-DL" from WEB-DL and short group tags are the classic false positives here.
    expect(describe({ url: 'u', ...bh('Show.01.1080p.WEB-DL.x264-NTb.mkv') }).audioLanguages).toEqual([])
  })
})

suite('season/episode parsing', () => {
  it('reads the cross-style 1x04 numbering', () => {
    expect(parseSeasonEp({ ...bh('Show 1x04 1080p') })).toEqual({ season: 1, episode: 4 })
  })
  it('reads a written episode number', () => {
    expect(parseSeasonEp({ ...bh('Show Episode 12 [1080p]') })).toEqual({ abs: 12 })
    expect(parseSeasonEp({ ...bh('Show EP 12 [1080p]') })).toEqual({ abs: 12 })
  })
  it('still reads SxxExx and absolute numbering', () => {
    expect(parseSeasonEp({ ...bh('Re Zero S04E01 1080p WEB') })).toEqual({ season: 4, episode: 1 })
    expect(parseSeasonEp({ ...bh('[SubsPlease] Re Zero - 67 (1080p)') })).toEqual({ abs: 67 })
  })
  it('does not read a resolution as an episode', () => {
    expect(parseSeasonEp({ ...bh('Show 1920x1080 x264') })).toEqual({})
  })
  it('does not read a CRC bracket as an episode', () => {
    expect(parseSeasonEp({ ...bh('[Group] Show - 07 [ABC1E404].mkv') })).toEqual({ abs: 7 })
  })
})

suite('notice detection', () => {
  it('drops a quota status card', () => {
    expect(isNotice({ name: 'AIO', description: 'Your subscription expires in 3 days', url: 'https://addon/config' })).toBe(true)
  })
  it('keeps a real file that happens to mention days left', () => {
    expect(isNotice({
      name: '[RD+] Addon',
      description: '📄 Show - 01 [3 days left].mkv',
      url: 'https://cdn/file.mkv',
      behaviorHints: { filename: 'Show - 01.mkv', videoSize: 100 },
    })).toBe(false)
  })
  it('keeps a torrent row with an infoHash whatever its text says', () => {
    expect(isNotice({ infoHash: 'abc', description: 'quota used: 40%' })).toBe(false)
  })
})
