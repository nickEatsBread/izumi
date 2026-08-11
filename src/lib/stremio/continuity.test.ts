import { describe, it, expect } from 'vitest'
import { matchesRelease, pickDirectPreloadCandidate, type ContinueHint } from './play'
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

  it('continues a real per-episode ASW release when the infohash changes', () => {
    const episode2 = {
      name: 'Torrentio\n1080p',
      infoHash: '4a0fec197db1950e70da12028531e5cd995551b2',
      behaviorHints: { filename: '[ASW] Oni no Hanayome - 02 [1080p HEVC][E24C66BA].mkv' },
    } as Stream
    const picked = pickDirectPreloadCandidate([episode2], {
      infoHash: 'episode-1-hash',
      group: 'ASW',
    }, { season: 1, episode: 2, abs: 2 })
    expect(picked).toBe(episode2)
  })

  it('does not treat every torrent from the same addon as the same release', () => {
    const torrentioOrigin = { kind: 'addon' as const, id: 'torrentio.strem.fun', name: 'Torrentio' }
    const doomdos = {
      name: 'Torrentio\n4k',
      infoHash: 'doomdos-episode-6',
      __origin: torrentioOrigin,
      behaviorHints: {
        bingeGroup: 'torrentio|4k|Doomdos',
        filename: '[Doomdos] The Exiled Heavy Knight - 6 [2160p].mkv',
      },
    } as Stream
    const toonsHub = {
      name: 'Torrentio\n1080p',
      infoHash: 'toonshub-episode-6',
      __origin: torrentioOrigin,
      behaviorHints: {
        bingeGroup: 'torrentio|1080p|ToonsHub',
        filename: 'The.Exiled.Heavy.Knight.S01E06.1080p-ToonsHub.mkv',
      },
    } as Stream
    const hint: ContinueHint = {
      infoHash: 'toonshub-episode-5',
      bingeGroup: 'torrentio|1080p|ToonsHub',
      group: 'ToonsHub',
      originId: 'torrentio.strem.fun',
    }

    expect(matchesRelease(doomdos, hint)).toBe(false)
    expect(pickDirectPreloadCandidate([doomdos, toonsHub], hint, {
      season: 1, episode: 6, abs: 6,
    })).toBe(toonsHub)
  })
})

// Audio flavour is part of an online source's release identity. Without it, switching an episode
// to dub mid-playback continued the NEXT episode on the same provider's sub row — silently undoing
// the switch the user had just made.
const flavoured = (originId: string, audio: 'sub' | 'dub'): Stream =>
  ({ ...online(originId), __audio: audio } as Stream)

describe('matchesRelease — audio flavour', () => {
  const hint: ContinueHint = { originId: 'prov', online: true, audio: 'dub' }

  it('continues on the same flavour and refuses the other one', () => {
    expect(matchesRelease(flavoured('prov', 'dub'), hint)).toBe(true)
    expect(matchesRelease(flavoured('prov', 'sub'), hint)).toBe(false)
  })

  it('ignores flavour when either side does not declare one', () => {
    // A provider that reports no flavour must behave exactly as it did before this rule existed,
    // rather than losing continuity entirely.
    expect(matchesRelease(online('prov'), hint)).toBe(true)
    expect(matchesRelease(flavoured('prov', 'sub'), { originId: 'prov', online: true })).toBe(true)
  })

  it('never lets flavour override a torrent identity', () => {
    // infoHash/bingeGroup/group are exact release matches; flavour only qualifies the origin rule.
    const torrent = { infoHash: 'abc', __audio: 'sub', name: '[G] Show - 03' } as Stream
    expect(matchesRelease(torrent, { infoHash: 'abc', audio: 'dub' })).toBe(true)
  })
})
