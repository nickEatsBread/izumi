import { describe, expect, it } from 'vitest'
import { pickCandidates, pickBest, preferDirectStartupCandidates, rankStreams } from './addon'
import { RESOLUTION_POINTS } from './score'

const row = (url: string, quality: string, extra: Record<string, unknown> = {}) =>
  ({ url, name: '[RD+] Addon', title: `[Group] Show - 01 (${quality})`, ...extra }) as never

describe('pickCandidates', () => {
  it('returns every cached source, not just the winner', () => {
    const streams = [row('a', '720p'), row('b', '1080p'), row('c', '2160p')]
    expect(pickCandidates(streams, 'any')).toHaveLength(3)
  })

  it('agrees with pickBest on the winner', () => {
    const streams = [row('a', '720p'), row('b', '1080p'), row('c', '2160p')]
    for (const q of ['any', '2160', '1080', '720', '480']) {
      expect(pickCandidates(streams, q)[0]).toBe(pickBest(streams, q))
    }
  })

  it('puts the requested tier first, then lower tiers, then higher', () => {
    const streams = [row('uhd', '2160p'), row('sd', '480p'), row('fhd', '1080p')]
    expect(pickCandidates(streams, '1080').map((s) => s.url)).toEqual(['fhd', 'sd', 'uhd'])
  })

  it('excludes uncached sources entirely', () => {
    const streams = [row('cached', '1080p'), { url: 'nope', name: '[RD download] Addon' } as never]
    expect(pickCandidates(streams, 'any').map((s) => s.url)).toEqual(['cached'])
  })

  it('drops a confident wrong-season file before ranking', () => {
    const streams = [
      row('right', '1080p', { behaviorHints: { filename: 'Show S04E01 1080p' } }),
      row('wrong', '2160p', { behaviorHints: { filename: 'Show S01E01 2160p' } }),
    ]
    expect(pickCandidates(streams, 'any', { season: 4 }).map((s) => s.url)).toEqual(['right'])
  })

  it('drops foreign-language sources when any in-language one exists', () => {
    const streams = [row('it', '2160p', { __langMismatch: true }), row('en', '720p')]
    expect(pickCandidates(streams, 'any').map((s) => s.url)).toEqual(['en'])
  })

  it('falls back to foreign-language sources when they are all there is', () => {
    const streams = [row('it', '1080p', { __langMismatch: true })]
    expect(pickCandidates(streams, 'any').map((s) => s.url)).toEqual(['it'])
  })

  it('returns nothing when nothing is cached', () => {
    expect(pickCandidates([{ url: 'x', name: '[RD download] Addon' } as never], 'any')).toEqual([])
    expect(pickBest([{ url: 'x', name: '[RD download] Addon' } as never], 'any')).toBeUndefined()
  })

  it('skips a source that is remembered as failed, but keeps it as a last resort', () => {
    const good = row('good', '1080p')
    const bad = row('bad', '2160p')
    const candidates = pickCandidates([bad, good], 'any', undefined, (s) => s.url === 'bad')
    expect(candidates.map((s) => s.url)).toEqual(['good', 'bad'])
  })
})

describe('direct P2P automatic startup order', () => {
  const torrent = (
    hash: string,
    quality: string,
    sizeMiB: number,
    seeders?: number,
    extra: Record<string, unknown> = {},
  ) => ({
    infoHash: hash,
    name: 'Source',
    title: `[Group] Show - 01 (${quality})${seeders == null ? '' : ` 👤 ${seeders}`}`,
    __seeders: seeders,
    behaviorHints: { filename: `[Group] Show - 01 (${quality}).mkv`, videoSize: sizeMiB * 1024 ** 2 },
    ...extra,
  }) as never

  it('promotes a streamable-size episode within the leading quality tier', () => {
    const huge = torrent('huge', '1080p', 3_451, 68)
    const efficient = torrent('efficient', '1080p', 650, 35)
    const lower = torrent('lower', '720p', 400, 100)
    expect(preferDirectStartupCandidates([huge, efficient, lower]))
      .toEqual([efficient, huge, lower])
  })

  it('keeps an oversized episode when that quality has no faster alternative', () => {
    const huge = torrent('huge', '1080p', 3_451, 68)
    const lower = torrent('lower', '720p', 400, 100)
    expect(preferDirectStartupCandidates([huge, lower])).toEqual([huge, lower])
  })

  it('avoids DHT-only metadata when a same-quality source has pinned metadata and peers', () => {
    const unknownPack = torrent('unknown-pack', '1080p', 72_000)
    const metadataPack = torrent('metadata-pack', '1080p', 13_000, 4, {
      __torrentUrl: 'https://example.test/metadata.torrent',
    })
    const lower = torrent('lower', '720p', 700, 100)
    expect(preferDirectStartupCandidates([unknownPack, metadataPack, lower]))
      .toEqual([metadataPack, unknownPack, lower])
  })

  it('does not displace a same-quality winner with confirmed peers', () => {
    const healthy = torrent('healthy', '1080p', 3_000, 50)
    const metadataPack = torrent('metadata-pack', '1080p', 13_000, 4, {
      __torrentUrl: 'https://example.test/metadata.torrent',
    })
    expect(preferDirectStartupCandidates([healthy, metadataPack]))
      .toEqual([healthy, metadataPack])
  })
})

describe('curated best release', () => {
  const HASH = 'a'.repeat(40)
  const opts = { seadexHashes: new Set([HASH]) }
  const curated = (q: string, extra: Record<string, unknown> = {}) =>
    row(`curated-${q}`, q, { infoHash: HASH, ...extra })

  // The mandated invariant, over the ladder rather than one hand-picked pair: curation is a
  // tie-break BELOW resolution, so a curated lower tier must never lead a plain higher one — not in
  // the list the user reads, not in the pick made for them, and not when they declined to name a
  // tier at all. The pair whose gap happens to be widest proves nothing about the pair whose gap
  // is 2: curation used to be the FIRST key of both orderings, which inverted every one of them.
  for (const [i, [higher]] of RESOLUTION_POINTS.entries()) {
    const lower = RESOLUTION_POINTS[i + 1]?.[0]
    if (!lower) continue
    const pair = () => [curated(`${lower}p`), row('plain', `${higher}p`)]
    for (const quality of ['any', String(higher)]) {
      it(`picks a plain ${higher}p over a curated ${lower}p on quality "${quality}"`, () => {
        expect(pickBest(pair(), quality, undefined, opts)?.url).toBe('plain')
      })
    }
    it(`lists a plain ${higher}p above a curated ${lower}p`, () => {
      expect(rankStreams(pair(), 'quality', opts).map((s) => s.url)).toEqual(['plain', `curated-${lower}p`])
    })
  }

  // The list is ordered by rankInfos while the "Best" pill and the auto-pick countdown come from
  // pickCandidates. While those two used different keys, a curated lower-tier release made row #1
  // and the row wearing the pill different rows — the badge pointed at something further down the
  // list. Asserted only where the two are asking the same question: a request for a tier that is
  // NOT the best available is meant to pull a lower row up, and only in the pick.
  it('leads the list with the row the automatic pick would take', () => {
    const scenarios: [ReturnType<typeof row>[], string][] = [
      [[curated('1080p'), row('plain', '2160p')], 'any'],
      [[curated('1080p'), row('plain', '2160p')], '2160'],
      [[curated('1080p'), row('plain', '1080p', { title: '[Group] Show - 01 (1080p) 👤 900' })], 'any'],
      [[curated('480p'), row('plain', '2160p'), row('mid', '1080p')], 'any'],
      [[curated('480p'), row('plain', '2160p'), row('mid', '1080p')], '2160'],
    ]
    for (const [streams, quality] of scenarios) {
      expect(rankStreams(streams, 'quality', opts)[0])
        .toBe(pickCandidates(streams, quality, undefined, undefined, opts)[0])
    }
  })

  it('leads within the tier that was asked for', () => {
    const streams = [row('plain', '1080p', { title: '[Group] Show - 01 (1080p) 👤 900' }), curated('1080p')]
    expect(pickBest(streams, '1080', undefined, opts)?.url).toBe('curated-1080p')
  })

  it('still wins the tier the user asked FOR, which is not curation crossing a tier', () => {
    // Asking for 720p and getting 720p is the setting doing its job; the curated row leads that
    // tier the same way it leads any other. Only the tier key may reorder resolutions here.
    const streams = [curated('720p'), row('plain', '1080p')]
    expect(pickBest(streams, '720', undefined, opts)?.url).toBe('curated-720p')
  })

  it('never outranks cache state', () => {
    // The curated release is worth waiting for only if the user said so; a curated download still
    // sorts below an instantly playable copy, exactly as the quality preference does.
    const streams = [
      { url: 'cached', name: '[RD+] Addon', title: '[Group] Show - 01 (1080p)' } as never,
      { url: 'uncached', name: '[RD download] Addon', title: '[Group] Show - 01 (1080p)', infoHash: HASH } as never,
    ]
    expect(pickCandidates(streams, '1080', undefined, undefined, { ...opts, allowUncached: true })
      .map((s) => s.url)).toEqual(['cached', 'uncached'])
  })

  it('decides between releases of the SAME resolution, which is all a tie-break may do', () => {
    // With Quality on "any" the tier key is inert by construction, so this is where curation has
    // to carry the case on its own — against the wall of better-seeded copies the recommendation
    // is nearly always up against, and without reaching across a resolution to do it.
    const streams = [row('plain', '1080p', { title: '[Group] Show - 01 (1080p) 👤 900' }), curated('1080p')]
    expect(pickBest(streams, 'any', undefined, opts)?.url).toBe('curated-1080p')
    expect(pickBest(streams, 'any')?.url).toBe('plain')
  })

  it('never costs a release the place its own health won it', () => {
    // The invariant is that curation cannot lift a row past a better resolution — not that a
    // curated row must sink below one. Health is still allowed to cross a tier (a barely-seeded 4K
    // should not lead anything), and annotating a release must leave that untouched in both
    // directions, or turning the setting on would DEMOTE the release it recommends.
    const streams = [row('plain', '2160p'), curated('1080p', { title: '[Other] Show - 01 (1080p) 👤 900' })]
    const order = (o?: typeof opts) => rankStreams(streams, 'quality', o).map((s) => s.url)
    expect(order()).toEqual(['curated-1080p', 'plain'])
    expect(order(opts)).toEqual(order())
    expect(pickBest(streams, 'any', undefined, opts)?.url).toBe('curated-1080p')
  })

  it('matches the hash case-insensitively, as the addons report it', () => {
    const streams = [row('plain', '1080p', { title: '[Group] Show - 01 (1080p) 👤 900' }), curated('1080p', { infoHash: HASH.toUpperCase() })]
    expect(pickBest(streams, '1080', undefined, opts)?.url).toBe('curated-1080p')
  })
})

describe('cached beats the requested quality tier', () => {
  const cached = (url: string, q: string) =>
    ({ url, name: '[RD+] Addon', title: `[Group] Show - 20 (${q})` }) as never
  const uncached = (url: string, q: string) =>
    ({ url, name: '[RD download] Addon', title: `[Group] Show - 20 (${q})` }) as never

  it('prefers a cached 1080p over an uncached 4K when 4K was requested', () => {
    // Real case: eleven cached 1080p rows and one uncached 2160p, Quality set to 4K. The tier
    // preference was applied AFTER the cache ordering and overrode it, so the automatic pick
    // committed to a multi-gigabyte download while instant copies sat right there.
    const picked = pickCandidates(
      [uncached('uhd', '2160p'), cached('fhd', '1080p')],
      '2160', undefined, undefined, { allowUncached: true },
    )
    expect(picked.map((s) => s.url)).toEqual(['fhd', 'uhd'])
  })

  it('still honours the requested tier among sources that are all cached', () => {
    const picked = pickCandidates([cached('fhd', '1080p'), cached('uhd', '2160p')], '2160')
    expect(picked[0].url).toBe('uhd')
  })
})
