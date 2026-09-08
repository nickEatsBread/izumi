import { describe, expect, it } from 'vitest'
import { refineStreamsLite, type RefineLiteContext } from './refine-lite'
import type { Stream } from './parse'

const named = (filename: string, extra: Record<string, unknown> = {}): Stream =>
  ({ url: `https://host/${encodeURIComponent(filename)}`, behaviorHints: { filename }, ...extra }) as Stream

const movie: RefineLiteContext = { titles: ['Example Film'], streamType: 'movie', year: 2026 }

describe('refineStreamsLite', () => {
  it('keeps the requested movie release', () => {
    const r = refineStreamsLite(movie, [named('Example.Film.2026.2160p.WEB-DL.DDP5.1.mkv')])
    expect(r.kept).toHaveLength(1)
    expect(r.rejectedCount).toBe(0)
  })

  it('rejects an older production sharing the title id', () => {
    const r = refineStreamsLite(movie, [
      named('Example.Film.2026.1080p.WEB-DL.mkv'),
      named('Example.Film.1997.DVDRip.XviD.avi'),
    ])
    expect(r.kept.map((s) => s.behaviorHints?.filename)).toEqual(['Example.Film.2026.1080p.WEB-DL.mkv'])
    expect(r.rejectedCount).toBe(1)
  })

  it('rejects an unrelated title that only shares a word', () => {
    const r = refineStreamsLite(movie, [
      named('Example.Film.2026.1080p.WEB-DL.mkv'),
      named('A.Space.Voyage.1968.REMASTERED.1080p.mkv'),
    ])
    expect(r.kept).toHaveLength(1)
    expect(r.rejectedCount).toBe(1)
  })

  it('rejects a release that disclaims its own production even with zero context', () => {
    const r = refineStreamsLite({ titles: [], streamType: 'movie' }, [
      named('Example Film 2026 (NOT the Famous Director FILM) 1080p WEB-DL HEVC x265 5.1 BONE.mkv'),
    ])
    expect(r.kept).toHaveLength(0)
    expect(r.rejectedCount).toBe(1)
  })

  it('rejects clean-release claims inside the theatrical window when cams prove it', () => {
    const ctx: RefineLiteContext = { ...movie, releasedAt: Date.now() - 50 * 86_400_000 }
    const rows = [
      named('Example.Film.2026.1080p.WEBRip.x264.AAC5.1-[YTS.GG - YTS.BZ].mp4'),
      named('Example.Film.2026.1080p.TELESYNC.HEVC.AAC2.0-SPLiCE.mkv'),
    ]
    const r = refineStreamsLite(ctx, rows)
    expect(r.kept.map((s) => s.behaviorHints?.filename)).toEqual(['Example.Film.2026.1080p.TELESYNC.HEVC.AAC2.0-SPLiCE.mkv'])
    // Without cam evidence (a real digital release) the same claim is kept.
    expect(refineStreamsLite(ctx, [rows[0]]).kept).toHaveLength(1)
    // Outside the window the claim is kept even beside cams lingering in the index.
    expect(refineStreamsLite({ ...movie, releasedAt: Date.now() - 200 * 86_400_000 }, rows).kept).toHaveLength(2)
  })

  it('rejects trailers and extras regardless of title match', () => {
    const r = refineStreamsLite(movie, [
      named('Example.Film.2026.1080p.mkv'),
      named('Example.Film.2026.Official.Trailer.1080p.mp4'),
    ])
    expect(r.kept).toHaveLength(1)
    expect(r.rejectedCount).toBe(1)
  })

  it('keeps opaque names — absence of evidence never rejects', () => {
    const cjk = named('架空の映画')
    const qualityOnly = { url: 'https://host/stream', title: '💾 1.4 GB', behaviorHints: {} } as Stream
    const r = refineStreamsLite(movie, [cjk, qualityOnly])
    expect(r.kept).toHaveLength(2)
  })

  it('applies no title rule to a series with a single alias', () => {
    // A lone display title cannot prove a romaji release wrong.
    const ctx: RefineLiteContext = { titles: ["Frieren: Beyond Journey's End"], streamType: 'series' }
    const r = refineStreamsLite(ctx, [named('[SubsPlease] Sousou no Frieren - 01 (1080p).mkv')])
    expect(r.kept).toHaveLength(1)
  })

  it('applies the title rule to a series once two aliases exist', () => {
    const ctx: RefineLiteContext = {
      titles: ["Frieren: Beyond Journey's End", 'Sousou no Frieren'],
      streamType: 'series',
      totalEpisodes: 28,
    }
    const r = refineStreamsLite(ctx, [
      named('[SubsPlease] Sousou no Frieren - 01 (1080p).mkv'),
      named('[Group] Completely Different Show S01E01 1080p.mkv'),
    ])
    expect(r.kept).toHaveLength(1)
    expect(r.rejectedCount).toBe(1)
  })

  it('rejects a sequel-season release when the base entry was requested', () => {
    const ctx: RefineLiteContext = { titles: ['Shingeki no Kyojin'], streamType: 'series', totalEpisodes: 25 }
    const r = refineStreamsLite(ctx, [
      named('[Group] Shingeki no Kyojin - 01 (1080p).mkv'),
      named('[Group] Shingeki no Kyojin The Final Season - 01 (1080p).mkv'),
    ])
    expect(r.kept).toHaveLength(1)
    expect(r.rejectedCount).toBe(1)
  })

  it('keeps sequel-season markers when no alias is known', () => {
    const ctx: RefineLiteContext = { titles: [], streamType: 'series' }
    const r = refineStreamsLite(ctx, [named('[Group] Some Show The Final Season - 01.mkv')])
    expect(r.kept).toHaveLength(1)
  })

  it('rejects a standalone movie file under a multi-episode series only when the count is known', () => {
    const file = named('Example.Classic.1995.BluRay.1080p.mkv')
    const withCount: RefineLiteContext = { titles: ['Example Classic'], streamType: 'series', totalEpisodes: 12 }
    const withoutCount: RefineLiteContext = { titles: ['Example Classic'], streamType: 'series' }
    expect(refineStreamsLite(withCount, [file]).kept).toHaveLength(0)
    expect(refineStreamsLite(withoutCount, [file]).kept).toHaveLength(1)
  })

  it('rejects an implausibly small file when the runtime is known', () => {
    const ctx: RefineLiteContext = {
      titles: ['Dr. Stone', 'Dr. Stone: Science Future'],
      streamType: 'series',
      totalEpisodes: 24,
      expectedSeconds: 24 * 60,
    }
    const r = refineStreamsLite(ctx, [
      named('[SubsPlease] Dr STONE S04E25 1080p.mkv', { description: '💾 7 MB' }),
      named('[SubsPlease] Dr STONE S04E25 1080p.mkv', { description: '💾 1.4 GB' }),
    ])
    expect(r.kept).toHaveLength(1)
    expect(r.rejectedCount).toBe(1)
  })

  it('drops SxxExx releases for a long absolute-numbered anime', () => {
    const ctx: RefineLiteContext = {
      titles: ['One Piece', 'ONE PIECE'],
      streamType: 'series',
      totalEpisodes: 1100,
      absoluteNumbered: true,
    }
    const r = refineStreamsLite(ctx, [
      named('[Erai-raws] One Piece - 1071 (1080p).mkv'),
      named('One.Piece.2023.S01E01.1080p.WEB.mkv'),
    ])
    expect(r.kept).toHaveLength(1)
    expect(r.rejectedCount).toBe(1)
  })

  it('returns everything untouched for an empty context', () => {
    const ctx: RefineLiteContext = { titles: [], streamType: 'series' }
    const rows = [named('anything.mkv'), named('[Group] Whatever - 01.mkv')]
    const r = refineStreamsLite(ctx, rows)
    expect(r.kept).toHaveLength(2)
    expect(r.rejectedCount).toBe(0)
  })
})
