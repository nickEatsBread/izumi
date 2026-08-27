import { describe, expect, it } from 'vitest'
import { candidateIds, groupCandidates, normalizeCandidates } from './candidate-model'
import type { Stream } from './parse'

const HASH = 'a'.repeat(40)
const torrent = (origin: string, extra: Partial<Stream> = {}): Stream => ({
  infoHash: HASH,
  __origin: { kind: 'torrent-extension', id: origin, name: origin },
  behaviorHints: { filename: 'Show - 01.mkv' },
  ...extra,
})

describe('candidate grouping', () => {
  it('models the same release from two sources as two retained offers', () => {
    const groups = groupCandidates([torrent('nyaa'), torrent('animetosho')])
    expect(groups).toHaveLength(1)
    expect(groups[0].offers).toHaveLength(2)
    expect(groups[0].offers.flatMap((offer) => offer.routes)).toHaveLength(2)

    const rows = normalizeCandidates([torrent('nyaa'), torrent('animetosho')])
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((row) => row.__candidate?.releaseId))).toHaveLength(1)
    expect(new Set(rows.map((row) => row.__candidate?.offerId))).toHaveLength(2)
    expect(rows.every((row) => row.__candidate?.offerCount === 2)).toBe(true)
  })

  it('retains distinct routes from one offer', () => {
    const rows = normalizeCandidates([
      torrent('addon', { url: 'https://one/video' }),
      torrent('addon', { url: 'https://two/video' }),
    ])
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((row) => row.__candidate?.offerId))).toHaveLength(1)
    expect(new Set(rows.map((row) => row.__candidate?.routeId))).toHaveLength(2)
    expect(rows[0].__candidate?.routeCount).toBe(2)
  })

  it('merges only an exact duplicate route and keeps its strongest evidence', () => {
    const rows = normalizeCandidates([
      torrent('nyaa', { __seeders: 0, __evidence: { confirmedMatch: false, upstreamRank: 4 } }),
      torrent('nyaa', { __seeders: 120, __evidence: { confirmedMatch: true, bestRelease: true, upstreamRank: 7 } }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].__seeders).toBe(120)
    expect(rows[0].__evidence).toMatchObject({ confirmedMatch: true, bestRelease: true, upstreamRank: 4 })
  })

  it('never puts a credential-bearing URL in an opaque id', () => {
    const token = 'secret-api-token'
    const ids = candidateIds({
      url: `https://resolver.example/${token}/video.mkv`,
      __origin: { kind: 'addon', id: 'safe-addon-id' },
    })
    expect(Object.values(ids).join(':')).not.toContain(token)
    expect(ids.routeId).toMatch(/^rte-[a-f0-9]{16}$/)
  })
})
