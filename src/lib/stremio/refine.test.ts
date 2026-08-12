import { describe, expect, it, vi } from 'vitest'

vi.mock('$lib/anilist/media', () => ({
  title: (m: { title: { romaji: string } }) => m.title.romaji,
  totalEpisodes: (m: { episodes?: number }) => m.episodes ?? 0,
}))

const { refineStreams } = await import('./refine')
const { pickBest } = await import('./addon')

const media = {
  title: { romaji: 'Dr. Stone', english: 'Dr. Stone' },
  format: 'TV',
  episodes: 24,
  duration: 24,
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

  it('rejects the two-minute Tanya mini-episode indexed as a full episode', () => {
    const r = refineStreams({
      title: { romaji: 'Youjo Senki II', english: 'Saga of Tanya the Evil Season 2' },
      format: 'TV',
      episodes: 12,
      duration: 24,
      startDate: { year: 2026 },
    } as never, [
      named('[SubsPlease] Youjo Senki S2 - 01 (1080p)', {
        behaviorHints: {
          filename: '[SubsPlease] Youjo Senki S2 - 01 (1080p).mkv',
          videoSize: 1_449_551_462,
        },
      }),
      named('[CenturyZeta] Youjo Shenki 2 - 01 (1080p) (Youjo Senki)', {
        behaviorHints: {
          filename: '[CenturyZeta] Youjo Shenki 2 - 01 (1080p).mkv',
          videoSize: 7_455_703,
        },
      }),
    ] as never)

    expect(r.kept).toHaveLength(1)
    expect(r.rejected).toEqual([expect.objectContaining({ reason: 'implausibly-small' })])
  })

  it('does not restore a tiny short when it is the only result', () => {
    const r = refineStreams(media, [
      named('Dr. Stone - 01 [1080p]', {
        behaviorHints: { filename: 'Dr. Stone - 01 [1080p].mkv', videoSize: 5_000_000 },
      }),
    ] as never)

    expect(r.kept).toHaveLength(0)
    expect(r.rejected[0]?.reason).toBe('implausibly-small')
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

  it('lets id verification bypass fuzzy title matching and trusts direct streams', () => {
    const r = refineStreams(media, [
      named('[SubsPlease] Dr STONE S04E25 1080p'),
      named('Totally Unrelated Thing', { __accuracy: 'high' }),
      named('Also Unrelated', { __stream: true }),
    ] as never)
    expect(r.kept).toHaveLength(3)
    expect(r.rejected).toHaveLength(0)
  })

  it('rejects an explicit wrong season even when the source marks the row id-verified', () => {
    const r = refineStreams(media, [
      named('[Group] Dr. Stone Season 2 - 01 (1080p)', {
        __accuracy: 'high',
        behaviorHints: { filename: '[Group] Dr. Stone Season 2 - 01 (1080p).mkv', videoSize: 800_000_000 },
      }),
    ] as never)
    expect(r.kept).toHaveLength(0)
    expect(r.rejected[0]?.reason).toBe('wrong-franchise-season')
  })

  it('still applies physical size checks to an id-verified torrent', () => {
    const r = refineStreams(media, [
      named('氷菓子 - 01', {
        __accuracy: 'high',
        behaviorHints: { filename: '氷菓子 - 01.mkv', videoSize: 5_000_000 },
      }),
    ] as never)
    expect(r.kept).toHaveLength(0)
    expect(r.rejected[0]?.reason).toBe('implausibly-small')
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

  // Reported: "One Piece Episode 1 chooses One Piece Fan Letter or one of the other OVAs."
  // Title-searching sources answer a query for a long-running series with its whole family of
  // spin-offs, all of which carry the base title in full. Nothing downstream could tell them
  // apart — the season verifier sees a matching episode 1, the ranker sees a modern well-seeded
  // 1080p release against a 1999 one — so the spin-off won the auto-pick.
  const onePiece = {
    title: { romaji: 'One Piece', english: 'One Piece' },
    format: 'TV',
    episodes: 1122,
    duration: 24,
    startDate: { year: 1999 },
  } as never

  it('keeps only the main series for a long-running series episode 1', () => {
    const r = refineStreams(onePiece, [
      named('[SubsPlease] One Piece Fan Letter - 01 (1080p) [ABCD1234].mkv', {
        behaviorHints: { filename: '[SubsPlease] One Piece Fan Letter - 01 (1080p) [ABCD1234].mkv', videoSize: 1_400_000_000 },
      }),
      named('[Erai-raws] One Piece - 001 [1080p][Multiple Subtitle][ENG][POR-BR].mkv', {
        behaviorHints: { filename: '[Erai-raws] One Piece - 001 [1080p][Multiple Subtitle][ENG][POR-BR].mkv', videoSize: 1_100_000_000 },
      }),
      named('One Piece Episode of Luffy - 01 [1080p].mkv', {
        behaviorHints: { filename: 'One Piece Episode of Luffy - 01 [1080p].mkv', videoSize: 1_300_000_000 },
      }),
    ] as never)

    expect(r.kept.map((s) => s.behaviorHints?.filename)).toEqual([
      '[Erai-raws] One Piece - 001 [1080p][Multiple Subtitle][ENG][POR-BR].mkv',
    ])
    expect(r.rejected.map((x) => x.reason)).toEqual(['title-mismatch', 'title-mismatch'])
  })

  it('the auto-pick lands on the main series, not the better-seeded spin-off', () => {
    const rows = [
      named('[SubsPlease] One Piece Fan Letter - 01 (1080p) [ABCD1234].mkv', {
        title: '[SubsPlease] One Piece Fan Letter - 01 (1080p)\n👤 4210 💾 1.40 GB',
        behaviorHints: { filename: '[SubsPlease] One Piece Fan Letter - 01 (1080p) [ABCD1234].mkv', videoSize: 1_400_000_000 },
      }),
      named('[Erai-raws] One Piece - 001 [480p].mkv', {
        title: '[Erai-raws] One Piece - 001 [480p]\n👤 31 💾 0.35 GB',
        behaviorHints: { filename: '[Erai-raws] One Piece - 001 [480p].mkv', videoSize: 350_000_000 },
      }),
    ] as never
    // Unfiltered, the spin-off wins on resolution and seeders.
    expect(pickBest(rows, 'any')?.behaviorHints?.filename)
      .toBe('[SubsPlease] One Piece Fan Letter - 01 (1080p) [ABCD1234].mkv')
    // Through the title gate, only the requested series is auto-playable.
    expect(pickBest(refineStreams(onePiece, rows).kept, 'any')?.behaviorHints?.filename)
      .toBe('[Erai-raws] One Piece - 001 [480p].mkv')
  })

  it('keeps the spin-off when the spin-off IS what was requested', () => {
    const fanLetter = {
      title: { romaji: 'One Piece Fan Letter', english: 'One Piece Fan Letter' },
      format: 'SPECIAL',
      episodes: 1,
      duration: 24,
      startDate: { year: 2024 },
    } as never
    const r = refineStreams(fanLetter, [
      named('[SubsPlease] One Piece Fan Letter - 01 (1080p) [ABCD1234].mkv', {
        behaviorHints: { filename: '[SubsPlease] One Piece Fan Letter - 01 (1080p) [ABCD1234].mkv', videoSize: 1_400_000_000 },
      }),
    ] as never)
    expect(r.kept).toHaveLength(1)
    expect(r.rejected).toHaveLength(0)
  })

  it('keeps only the requested arc of a long-running detective series', () => {
    const conan = {
      title: { romaji: 'Meitantei Conan', english: 'Detective Conan' },
      format: 'TV',
      episodes: 1150,
      duration: 24,
      startDate: { year: 1996 },
    } as never
    const r = refineStreams(conan, [
      named('[Group] Detective Conan The Culprit Hanzawa - 01 [1080p].mkv', {
        behaviorHints: { filename: '[Group] Detective Conan The Culprit Hanzawa - 01 [1080p].mkv', videoSize: 1_400_000_000 },
      }),
      named('[Group] Meitantei Conan - 0001 [1080p].mkv', {
        behaviorHints: { filename: '[Group] Meitantei Conan - 0001 [1080p].mkv', videoSize: 900_000_000 },
      }),
      named('Meitantei Conan Zero no Tea Time - 01 (1080p).mkv', {
        behaviorHints: { filename: 'Meitantei Conan Zero no Tea Time - 01 (1080p).mkv', videoSize: 1_200_000_000 },
      }),
    ] as never)
    expect(r.kept.map((s) => s.behaviorHints?.filename)).toEqual(['[Group] Meitantei Conan - 0001 [1080p].mkv'])
  })

  it('keeps only the requested entry of a long-running shounen franchise', () => {
    const dbSuper = {
      title: { romaji: 'Dragon Ball Super', english: 'Dragon Ball Super' },
      format: 'TV',
      episodes: 131,
      duration: 24,
      startDate: { year: 2015 },
    } as never
    const r = refineStreams(dbSuper, [
      named('[Group] Dragon Ball Super Super Hero - 01 [1080p].mkv', {
        behaviorHints: { filename: '[Group] Dragon Ball Super Super Hero - 01 [1080p].mkv', videoSize: 1_400_000_000 },
      }),
      named('[Group] Dragon Ball Super - 001 [1080p][Multiple Subtitle].mkv', {
        behaviorHints: { filename: '[Group] Dragon Ball Super - 001 [1080p][Multiple Subtitle].mkv', videoSize: 1_000_000_000 },
      }),
      named('Dragon Ball Super Broly - 01 (BD 1080p).mkv', {
        behaviorHints: { filename: 'Dragon Ball Super Broly - 01 (BD 1080p).mkv', videoSize: 3_000_000_000 },
      }),
    ] as never)
    expect(r.kept.map((s) => s.behaviorHints?.filename))
      .toEqual(['[Group] Dragon Ball Super - 001 [1080p][Multiple Subtitle].mkv'])
  })

  it('marks same-hash addon rows as a pack before applying the standalone-movie rule', () => {
    const pack = (url: string) => ({
      url,
      infoHash: 'masamune-pack',
      behaviorHints: { filename: '[smol] Dr Stone (BD 1080p HEVC Opus)' },
    })
    const r = refineStreams(media, [pack('https://host/ep1'), pack('https://host/ep2')] as never)
    expect(r.kept).toHaveLength(1)
    expect(r.rejected).toHaveLength(0)
  })
})
