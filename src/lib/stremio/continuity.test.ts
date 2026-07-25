import { describe, it, expect } from 'vitest'
import { matchesRelease, type ContinueHint } from './play'
import type { Stream } from './parse'

// Release continuity across episodes. A torrent row is identified by bingeGroup / infoHash /
// release group; a DIRECT online row has none of those — no infoHash, no bingeGroup, and a
// filename ("<Title> — Episode 3") that carries no release group — so nothing matched and the
// picker reopened on every episode of a binge.

const online = (originId: string): Stream => ({
  url: `https://cdn/${originId}.m3u8`,
  name: `⚡ ${originId}`,
  __stream: true,
  __addonName: originId,
  __origin: { kind: 'online-extension', id: originId, name: originId },
  behaviorHints: { filename: 'Some Show — Episode 3' },
} as Stream)

describe('matchesRelease — direct online sources', () => {
  it('continues on the same provider', () => {
    const hint: ContinueHint = { originId: 'animepahe' }
    expect(matchesRelease(online('animepahe'), hint)).toBe(true)
  })

  it('does not continue on a different provider', () => {
    // The whole point: episode 2 must not silently jump to another site (possibly another
    // language) just because it answered first.
    const hint: ContinueHint = { originId: 'animepahe' }
    expect(matchesRelease(online('animeunity'), hint)).toBe(false)
  })

  it('does not match a row that has no origin at all', () => {
    const hint: ContinueHint = { originId: 'animepahe' }
    expect(matchesRelease({ url: 'https://t/x', name: 'x' } as Stream, hint)).toBe(false)
  })

  it('an empty hint matches nothing, so the picker opens normally', () => {
    expect(matchesRelease(online('animepahe'), {})).toBe(false)
  })
})

describe('matchesRelease — torrent identities still work', () => {
  it('matches on infoHash', () => {
    const s = { name: 'x', infoHash: 'abc' } as Stream
    expect(matchesRelease(s, { infoHash: 'abc' })).toBe(true)
    expect(matchesRelease(s, { infoHash: 'def' })).toBe(false)
  })

  it('matches on bingeGroup', () => {
    const s = { name: 'x', behaviorHints: { bingeGroup: 'g1' } } as Stream
    expect(matchesRelease(s, { bingeGroup: 'g1' })).toBe(true)
    expect(matchesRelease(s, { bingeGroup: 'g2' })).toBe(false)
  })

  it('matches on the parsed release group, case-insensitively', () => {
    // The group is parsed from the FILENAME, not the display name.
    const s = { name: 'x', behaviorHints: { filename: '[SubsPlease] Some Show - 03 (1080p).mkv' } } as Stream
    expect(matchesRelease(s, { group: 'subsplease' })).toBe(true)
    expect(matchesRelease(s, { group: 'Erai-raws' })).toBe(false)
  })

  it('any one identity is enough', () => {
    // A torrent row carries no origin; an online row carries only an origin. Neither should be
    // required to satisfy the other's field.
    const s = { name: 'x', infoHash: 'abc' } as Stream
    expect(matchesRelease(s, { infoHash: 'abc', originId: 'animepahe' })).toBe(true)
  })
})
