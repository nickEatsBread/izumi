import { describe, it, expect } from 'vitest'
import { dedupeStreams, dedupeBy } from './dedupe'
import type { Stream } from './parse'

const HASH = '869c1500723ab6ba669d83ea4343aea7bb990730'
const ext = (seeders: number | undefined, name: string, hash = HASH): Stream => ({
  infoHash: hash,
  __seeders: seeders,
  __origin: { kind: 'torrent-extension', id: name.toLowerCase(), name },
  name,
})
const addon = (hash = HASH): Stream => ({ infoHash: hash, name: 'Torrentio', url: undefined })

describe('dedupeStreams', () => {
  it('a later live-seeded extension copy replaces a 0-seeder copy of the same hash', () => {
    // tsuki-style indexer reports 0 for everything; nyaa reports the real 165 for the SAME torrent.
    const out = dedupeStreams([ext(0, 'Tsuki'), ext(165, 'Nyaa')])
    expect(out).toHaveLength(1)
    expect(out[0].__seeders).toBe(165)
    expect(out[0].name).toBe('Nyaa')
  })

  it('an unknown-seeders copy is also upgraded by a known one', () => {
    const out = dedupeStreams([ext(undefined, 'Tsuki'), ext(3, 'Nyaa')])
    expect(out[0].__seeders).toBe(3)
  })

  it('first wins between copies with equal-or-worse knowledge (stable order)', () => {
    const out = dedupeStreams([ext(10, 'A'), ext(3, 'B'), ext(10, 'C')])
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('A')
  })

  it('an extension dupe never displaces an addon row', () => {
    const out = dedupeStreams([addon(), ext(999, 'Nyaa')])
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('Torrentio')
  })

  it('distinct hashes all survive in order', () => {
    const out = dedupeStreams([ext(1, 'A', 'b'.repeat(40)), ext(2, 'B', 'c'.repeat(40))])
    expect(out).toHaveLength(2)
  })

  it('keyless rows pass through untouched', () => {
    const out = dedupeStreams([{}, {}] as Stream[])
    expect(out).toHaveLength(2)
  })
})

// dedupeBy is the shared primitive that BOTH the infoHash-keyed batch collapse (collapseBatches)
// and the url-keyed cross-addon dedupe delegate to — the seeder tiebreak has to live here or the
// batch-collapse pass (which runs FIRST, keyed on infoHash) silently drops the live-seeded copy
// of a same-hash extension duplicate before the url-keyed pass ever sees it.
describe('dedupeBy (infoHash-keyed — the collapseBatches path)', () => {
  const byHash = (s: Stream) => s.infoHash ?? ''

  it('keeps the live-seeded copy regardless of arrival order (the HAR tsuki-0 vs nyaa-165 case)', () => {
    const zeroFirst = dedupeBy([ext(0, 'Tsuki'), ext(165, 'Nyaa')], byHash)
    expect(zeroFirst).toHaveLength(1)
    expect(zeroFirst[0].__seeders).toBe(165)

    const liveFirst = dedupeBy([ext(165, 'Nyaa'), ext(0, 'Tsuki')], byHash)
    expect(liveFirst).toHaveLength(1)
    expect(liveFirst[0].__seeders).toBe(165)
  })

  it('collapses a Torrentio batch pack (same hash, many file-rows, addon) to the first row', () => {
    // Addon rows are not torrent-extension, so the seeder tiebreak never fires → pure first-wins,
    // preserving the existing pack-collapse behavior (One Piece 458-file dub pack → 1).
    const pack: Stream[] = [
      { infoHash: 'd'.repeat(40), name: 'Pack', url: 'u1', behaviorHints: { filename: 'ep01.mkv' } },
      { infoHash: 'd'.repeat(40), name: 'Pack', url: 'u2', behaviorHints: { filename: 'ep02.mkv' } },
      { infoHash: 'd'.repeat(40), name: 'Pack', url: 'u3', behaviorHints: { filename: 'ep03.mkv' } },
    ]
    const out = dedupeBy(pack, byHash)
    expect(out).toHaveLength(1)
    expect(out[0].behaviorHints?.filename).toBe('ep01.mkv')
  })

  it('passes rows with no infoHash through untouched', () => {
    const out = dedupeBy([{ url: 'a' }, { url: 'b' }] as Stream[], byHash)
    expect(out).toHaveLength(2)
  })
})
