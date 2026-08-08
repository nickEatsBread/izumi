import { describe as suite, it, expect } from 'vitest'
import { isUncached, isCached, describe, isWrongSeason } from './parse'

suite('streaming source cache state', () => {
  it('a __stream source is never uncached', () => {
    expect(isUncached({ url: 'https://cdn/x.m3u8', __stream: true })).toBe(false)
  })

  it('a __stream source is never uncached even when its text says download', () => {
    expect(isUncached({ url: 'https://cdn/x.m3u8', __stream: true, description: 'download server 2' })).toBe(false)
  })
})

suite('uncached detection', () => {
  it('matches the bare word "download"', () => {
    expect(isUncached({ name: 'Provider', title: 'RD download' })).toBe(true)
  })

  it('matches an unbracketed provider download marker', () => {
    expect(isUncached({ name: 'Comet', description: 'TB download · 1.4 GB' })).toBe(true)
  })

  it('matches the word "uncached"', () => {
    expect(isUncached({ name: 'AIO', description: 'uncached' })).toBe(true)
  })

  it('matches a download glyph carried in description, not just name', () => {
    expect(isUncached({ name: 'Comet', description: '⬇️ 1080p WEB-DL' })).toBe(true)
  })

  it('still matches the bracketed provider form', () => {
    expect(isUncached({ name: '[RD download] Torrentio' })).toBe(true)
  })

  it('does not match an ordinary release name', () => {
    expect(isUncached({ name: 'Torrentio', title: '[SubsPlease] Dr STONE - 25 (1080p)' })).toBe(false)
  })
})

suite('cached detection', () => {
  it('matches a lightning glyph carried in description, not just name', () => {
    expect(isCached({ name: 'Comet', description: '⚡ instant' })).toBe(true)
  })

  it('matches a check-mark cached marker', () => {
    expect(isCached({ name: 'AIO ✅' })).toBe(true)
  })

  it('uncached still wins over a cached marker on the same row', () => {
    expect(isCached({ name: '⚡', description: 'RD download' })).toBe(false)
  })
})

suite('describe() memoisation', () => {
  it('returns the identical result object for the same stream', () => {
    // The picker re-derives StreamInfo on every source arrival and again per render; parsing
    // each row once per identity is what keeps that from being ~2N regex passes a frame.
    const s = { url: 'https://host/f.mkv', title: '[Group] Show - 01 (1080p) 👤 42' }
    expect(describe(s)).toBe(describe(s))
  })

  it('does not share a result between two structurally equal streams', () => {
    const a = { url: 'https://host/f.mkv', title: 'Show - 01' }
    const b = { url: 'https://host/f.mkv', title: 'Show - 01' }
    expect(describe(a)).not.toBe(describe(b))
    expect(describe(a).label).toBe(describe(b).label)
  })
})

suite('describe() cache classification', () => {
  it('treats a bare infoHash with no url and no marker as unknown', () => {
    expect(describe({ infoHash: 'abc123', title: '[Group] Show - 01 (1080p)' }).cached).toBe('unknown')
  })

  it('keeps a resolved url with no marker instant', () => {
    expect(describe({ url: 'https://host/file.mkv', title: '[Group] Show - 01' }).cached).toBe('instant')
  })

  it('never marks a bare infoHash down just because seeders are 0', () => {
    // Extension indexers hardcode 0 seeders; a 'down' row reads as unplayable.
    expect(describe({ infoHash: 'abc123', title: '[Group] Show - 01 👤 0' }).cached).toBe('unknown')
  })

  it('still marks an explicitly-uncached zero-seeder torrent down', () => {
    expect(describe({ infoHash: 'abc', name: '[RD download]', title: 'Show - 01 👤 0' }).cached).toBe('down')
  })
})

suite('cache state tri-state', () => {
  it('a direct url with no infoHash stays instant', () => {
    expect(describe({ name: 'Server 1', url: 'https://x/ep.mp4' }).cached).toBe('instant')
  })
  it('an infoHash with no cache glyph is unknown, not instant', () => {
    expect(describe({ name: '[SubsPlease] Show - 01', infoHash: 'abc123' }).cached).toBe('unknown')
  })
  it('an explicit cached glyph still wins', () => {
    expect(describe({ name: '[RD+] Show', infoHash: 'abc123' }).cached).toBe('instant')
  })
  it('an explicit uncached glyph still wins', () => {
    expect(describe({ name: '[RD download] Show', infoHash: 'abc123' }).cached).toBe('uncached')
  })
  it('uncached with zero seeders is still down', () => {
    expect(describe({ name: '[RD download] Show 👤 0', infoHash: 'abc123' }).cached).toBe('down')
  })
  it('glyph-derived state is marked as coming from the glyph', () => {
    expect(describe({ name: '[RD+] Show', infoHash: 'abc' }).cacheSource).toBe('glyph')
  })
  it('a __cache hint resolves an otherwise-unknown row', () => {
    const r = describe({ name: 'Show', infoHash: 'abc', __cache: 'cached', __cacheSource: 'native' })
    expect(r.cached).toBe('instant')
    expect(r.cacheSource).toBe('native')
  })
  it('a __cache uncached hint demotes the row', () => {
    expect(describe({ name: 'Show', infoHash: 'abc', __cache: 'uncached' }).cached).toBe('uncached')
  })
  it('a __cache uncached hint with zero seeders is still down', () => {
    // Same "nothing for the debrid service to fetch" logic as the glyph branch — a
    // provider-confirmed uncached torrent with 0 seeders is exactly as dead as a glyph-confirmed one.
    expect(describe({ name: 'Show 👤 0', infoHash: 'abc', __cache: 'uncached' }).cached).toBe('down')
  })
  it('an addon glyph beats a __cache hint', () => {
    const r = describe({ name: '[RD download] Show 👤 5', infoHash: 'abc', __cache: 'cached' })
    expect(r.cached).toBe('uncached')
    expect(r.cacheSource).toBe('glyph')
  })
  it('a __cache hint carries a library source through, not just native', () => {
    const r = describe({ name: 'Show', infoHash: 'abc', __cache: 'cached', __cacheSource: 'library' })
    expect(r.cacheSource).toBe('library')
  })
  it('a __cache hint with no explicit source defaults to native', () => {
    const r = describe({ name: 'Show', infoHash: 'abc', __cache: 'cached' })
    expect(r.cacheSource).toBe('native')
  })
})

suite('isWrongSeason with a TVDB absolute mapping', () => {
  // Live AniZip for AniList 171110 (Ascendance of a Bookworm S4), episode 17:
  //   seasonNumber 1, episodeNumber 43, absoluteEpisodeNumber 43
  // TVDB folds the whole franchise into one season and counts through it; every release is named
  // by cour (`S4 - 17`). Comparing the two coordinate systems dropped all four correct files and
  // kept only the one numbered TVDB's way, so the picker cleared itself a moment after filling.
  const want = { episode: 17, season: 1, abs: 43 }
  const named = (filename: string) => ({ behaviorHints: { filename } }) as never

  it('keeps a cour-numbered release whose season TVDB does not model', () => {
    expect(isWrongSeason(named('[ASW] Honzuki no Gekokujou S4 - 17 [1080p HEVC x265 10Bit][AAC]'), want)).toBe(false)
    expect(isWrongSeason(named('[Judas] Honzuki no Gekokujou - S04E17 [1080p][HEVC x265 10bit]'), want)).toBe(false)
  })

  it('accepts either numbering for the same episode', () => {
    // 17 is the cour number, 43 the absolute one. Both name this episode.
    expect(isWrongSeason(named('[Erai-raws] Honzuki no Gekokujou - Ryushu no Youjo - 17v2 [1080p]'), want)).toBe(false)
    expect(isWrongSeason(named('[YE] Honzuki no Gekokujou - 43 (ytv 1280x720 x265 10bit AAC)'), want)).toBe(false)
    expect(isWrongSeason(named('[Group] Honzuki no Gekokujou S01E43 [1080p]'), want)).toBe(false)
  })

  it('still rejects an episode that matches neither number', () => {
    expect(isWrongSeason(named('[ASW] Honzuki no Gekokujou S4 - 12 [1080p]'), want)).toBe(true)
    expect(isWrongSeason(named('[YE] Honzuki no Gekokujou - 99 (ytv)'), want)).toBe(true)
  })

  it('keeps comparing seasons when TVDB does split the show by cour', () => {
    // season > 1 means TVDB agrees with the cour numbering, so a mismatch is real again — this is
    // the Torrentio season-overflow case the guard exists for.
    const split = { episode: 1, season: 4, abs: 40 }
    expect(isWrongSeason(named('[Group] Show S01E01 [1080p]'), split)).toBe(true)
    expect(isWrongSeason(named('[Group] Show S04E01 [1080p]'), split)).toBe(false)
  })

  it('leaves the no-absolute-mapping behaviour alone', () => {
    const plain = { episode: 7, season: 1 }
    expect(isWrongSeason(named('[Group] Show - 07 [1080p]'), plain)).toBe(false)
    expect(isWrongSeason(named('[Group] Show - 12 [1080p]'), plain)).toBe(true)
    expect(isWrongSeason(named('[Group] Show S02E07 [1080p]'), plain)).toBe(true)
  })
})
