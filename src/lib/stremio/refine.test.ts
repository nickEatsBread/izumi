import { describe, expect, it, vi } from 'vitest'

vi.mock('$lib/anilist/media', () => ({
  title: (m: { title: { romaji: string } }) => m.title.romaji,
  totalEpisodes: (m: { episodes?: number }) => m.episodes ?? 0,
}))

const { refineStreams } = await import('./refine')

const media = {
  title: { romaji: 'Dr. Stone', english: 'Dr. Stone' },
  format: 'TV',
  episodes: 24,
  startDate: { year: 2019 },
} as never

const named = (filename: string, extra: Record<string, unknown> = {}) =>
  ({ url: `https://host/${encodeURIComponent(filename)}`, behaviorHints: { filename }, ...extra })

describe('refineStreams', () => {
  it('keeps a matching release and reports nothing rejected', () => {
    const r = refineStreams(media, [named('[SubsPlease] Dr STONE S04E25 1080p')] as never)
    expect(r.kept).toHaveLength(1)
    expect(r.rejected).toHaveLength(0)
  })

  it('rejects an unrelated title with a title-mismatch reason', () => {
    const r = refineStreams(media, [
      named('[SubsPlease] Dr STONE S04E25 1080p'),
      named('[Group] Completely Different Show S01E01 1080p'),
    ] as never)
    expect(r.kept).toHaveLength(1)
    expect(r.rejected).toEqual([expect.objectContaining({ reason: 'title-mismatch' })])
  })

  it('rejects a creditless opening as an episode-extra', () => {
    const r = refineStreams(media, [
      named('[SubsPlease] Dr STONE S04E25 1080p'),
      named('Dr. Stone NCOP 2 [4K 60FPS Creditless]'),
    ] as never)
    expect(r.rejected).toEqual([expect.objectContaining({ reason: 'episode-extra' })])
  })

  it('restores the whole pool rather than returning an empty list', () => {
    // Every predicate firing at once used to leave the picker empty and blame dead torrents for
    // the app's own filtering. The season verifier has always had this guard; refine needs it too.
    const r = refineStreams(media, [
      named('[Group] Completely Different Show S01E01 1080p'),
      named('[Group] Another Unrelated Thing S01E02 1080p'),
    ] as never)
    expect(r.kept).toHaveLength(2)
    expect(r.rejected).toHaveLength(0)
  })

  it('never filters an id-verified or direct-stream source', () => {
    const r = refineStreams(media, [
      named('[SubsPlease] Dr STONE S04E25 1080p'),
      named('Totally Unrelated Thing', { __accuracy: 'high' }),
      named('Also Unrelated', { __stream: true }),
    ] as never)
    expect(r.kept).toHaveLength(3)
    expect(r.rejected).toHaveLength(0)
  })

  it('reports each rejected row once, not once per duplicate', () => {
    const dupe = { url: 'https://host/same', behaviorHints: { filename: '[Group] Unrelated Show S01E01' } }
    const r = refineStreams(media, [
      named('[SubsPlease] Dr STONE S04E25 1080p'),
      dupe,
      { ...dupe },
    ] as never)
    expect(r.rejected).toHaveLength(1)
  })

  it('collapses a multi-file batch pack to one row before filtering', () => {
    const pack = (n: number) => ({ infoHash: 'deadbeef', behaviorHints: { filename: `Dr Stone S01E${n} 1080p` } })
    const r = refineStreams(media, [pack(1), pack(2), pack(3)] as never)
    expect(r.kept).toHaveLength(1)
  })
})
