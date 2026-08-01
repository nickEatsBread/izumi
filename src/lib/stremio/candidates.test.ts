import { describe, expect, it } from 'vitest'
import { pickCandidates, pickBest } from './addon'
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

describe('curated best release', () => {
  const HASH = 'a'.repeat(40)
  const opts = { seadexHashes: new Set([HASH]) }
  const curated = (q: string, extra: Record<string, unknown> = {}) =>
    row(`curated-${q}`, q, { infoHash: HASH, ...extra })

  // The mandated invariant, over the ladder rather than one hand-picked pair: an automatic pick
  // must never hand back a lower tier than the one that was asked for because a human liked it.
  // The pair whose gap happens to be widest proves nothing about the pair whose gap is 2.
  for (const [i, [higher]] of RESOLUTION_POINTS.entries()) {
    const lower = RESOLUTION_POINTS[i + 1]?.[0]
    if (!lower) continue
    it(`picks a plain ${higher}p over a curated ${lower}p when ${higher} was asked for`, () => {
      const streams = [curated(`${lower}p`), row('plain', `${higher}p`)]
      expect(pickBest(streams, String(higher), undefined, opts)?.url).toBe('plain')
    })
  }

  it('leads within the tier that was asked for', () => {
    const streams = [row('plain', '1080p', { title: '[Group] Show - 01 (1080p) 👤 900' }), curated('1080p')]
    expect(pickBest(streams, '1080', undefined, opts)?.url).toBe('curated-1080p')
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

  it('decides on "any", where the user declined to name a tier at all', () => {
    // With Quality on "any" the tier key is inert by construction, so this is the one case where
    // curation orders across resolutions — and it is the case where the user asked it to.
    const streams = [row('plain', '2160p'), curated('1080p')]
    expect(pickBest(streams, 'any', undefined, opts)?.url).toBe('curated-1080p')
    expect(pickBest(streams, 'any')?.url).toBe('plain')
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
