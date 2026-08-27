import { describe, it, expect } from 'vitest'
import { dedupeStreams } from './dedupe'
import type { Stream } from './parse'

const HASH = '869c1500723ab6ba669d83ea4343aea7bb990730'
const ext = (seeders: number | undefined, name: string, hash = HASH, origin = name.toLowerCase()): Stream => ({
  infoHash: hash,
  __seeders: seeders,
  __origin: { kind: 'torrent-extension', id: origin, name },
  name,
})
const addon = (hash = HASH): Stream => ({ infoHash: hash, name: 'Torrentio', url: undefined })

describe('dedupeStreams', () => {
  it('a later live-seeded extension copy replaces a 0-seeder copy of the same hash', () => {
    // tsuki-style indexer reports 0 for everything; nyaa reports the real 165 for the SAME torrent.
    const out = dedupeStreams([ext(0, 'Nyaa'), ext(165, 'Nyaa')])
    expect(out).toHaveLength(1)
    expect(out[0].__seeders).toBe(165)
    expect(out[0].name).toBe('Nyaa')
  })

  it('an unknown-seeders copy is also upgraded by a known one', () => {
    const out = dedupeStreams([ext(undefined, 'Nyaa'), ext(3, 'Nyaa')])
    expect(out[0].__seeders).toBe(3)
  })

  it('first wins between copies with equal-or-worse knowledge (stable order)', () => {
    const out = dedupeStreams([ext(10, 'A', HASH, 'same'), ext(3, 'B', HASH, 'same'), ext(10, 'C', HASH, 'same')])
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('A')
  })

  it('retains an addon and extension as separate offers for one release', () => {
    const out = dedupeStreams([addon(), ext(999, 'Nyaa')])
    expect(out).toHaveLength(2)
    expect(out[0].name).toBe('Torrentio')
    expect(out[1].name).toBe('Nyaa')
    expect(out[0].__candidate?.releaseId).toBe(out[1].__candidate?.releaseId)
    expect(out[0].__candidate?.offerId).not.toBe(out[1].__candidate?.offerId)
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
