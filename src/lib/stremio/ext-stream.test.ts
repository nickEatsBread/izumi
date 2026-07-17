import { describe, it, expect } from 'vitest'
import { extToStream } from './ext-stream'
import type { TorrentResult } from '$lib/extensions/types'

const HASH = 'a'.repeat(40)
const base: TorrentResult = { title: 'Rel S01E03', hash: HASH, type: 'best' }

describe('extToStream', () => {
  it('omits the seeder glyph entirely when the source does not report seeders', () => {
    const s = extToStream({ ...base, size: 214053749 }, 'Nyaa')
    expect(s.title).toBe('Rel S01E03\n💾 0.20 GB')
    expect(s.title).not.toContain('👤')
    expect(s.__seeders).toBeUndefined()
  })

  it('does NOT bake "👤 0" for a hardcoded/absent zero (that round-trips to a dead marker)', () => {
    // seadex/tsuki hardcode seeders:0 when they have no data. Rendering "👤 0" made parse.ts
    // read 0 back out of the title and mark the row dead. Emit no glyph; keep the raw 0 in
    // __seeders so dedupe still ranks it below a live-seeded copy of the same hash.
    const s = extToStream({ ...base, seeders: 0 }, 'Tsuki')
    expect(s.title).not.toContain('👤')
    expect(s.__seeders).toBe(0)
  })

  it('carries a live seeder count into both the title and __seeders', () => {
    const s = extToStream({ ...base, seeders: 41, size: 214053749 }, 'Nyaa')
    expect(s.title).toBe('Rel S01E03\n👤 41 💾 0.20 GB')
    expect(s.__seeders).toBe(41)
  })

  it('leaves the title bare when there is no metadata at all', () => {
    const s = extToStream(base, 'Nyaa')
    expect(s.title).toBe('Rel S01E03')
  })
})
