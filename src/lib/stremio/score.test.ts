import { describe as suite, it, expect } from 'vitest'
import { scoreInfo, TRUSTED_GROUPS } from './score'
import { describe } from './parse'

const info = (filename: string, extra: Record<string, unknown> = {}) =>
  describe({ url: `https://host/${encodeURIComponent(filename)}`, behaviorHints: { filename }, ...extra })

const score = (filename: string, extra: Record<string, unknown> = {}, opts?: Parameters<typeof scoreInfo>[1]) =>
  scoreInfo(info(filename, extra), opts).score

suite('scoreInfo', () => {
  it('scores a plain release at zero-ish and explains every point it gives', () => {
    const r = scoreInfo(info('[Nobody] Show - 01 (1080p).mkv'))
    expect(r.reasons.every((x) => x.delta !== 0)).toBe(true)
    expect(r.score).toBe(r.reasons.reduce((n, x) => n + x.delta, 0))
  })

  it('rewards a better-seeded release', () => {
    expect(score('Show - 01 (1080p) 👤 120')).toBeGreaterThan(score('Show - 01 (1080p) 👤 3'))
  })

  it('caps the seeder reward so a swarm cannot outweigh everything else', () => {
    expect(score('Show - 01 👤 100000')).toBe(score('Show - 01 👤 100'))
  })

  it('favours a smaller healthy encode when bytes must come directly from P2P', () => {
    const torrent = (size: number) => describe({
      infoHash: 'aabbcc',
      __seeders: 150,
      behaviorHints: { filename: 'Show - 01 (1080p).mkv', videoSize: size },
    })
    const small = scoreInfo(torrent(400 * 1024 ** 2), { directP2p: true }).score
    const large = scoreInfo(torrent(1_500 * 1024 ** 2), { directP2p: true }).score
    expect(small).toBeGreaterThan(large)
  })

  it('ranks the efficient Clevatess dual-audio release above the slow 1.5 GB one for P2P', () => {
    const torrent = (filename: string, size: number, seeders: number) => describe({
      infoHash: filename,
      __seeders: seeders,
      behaviorHints: { filename, videoSize: size },
    })
    const judas = torrent(
      '[Judas] Clevatess - S02E01 [1080p][HEVC x265 10bit][Dual-Audio][Multi-Subs].mkv',
      542 * 1024 ** 2,
      144,
    )
    const anozu = torrent(
      'Clevatess.2025.S02E01.REPACK.1080p.CR.WEB-DL.DUAL.DDP2.0.H.264-AnoZu.mkv',
      1_400 * 1024 ** 2,
      172,
    )
    expect(scoreInfo(judas, { directP2p: true }).score)
      .toBeGreaterThan(scoreInfo(anozu, { directP2p: true }).score)
  })

  it('ranks a streamable episode above Masamune-sized Blu-ray files in direct P2P mode', () => {
    const torrent = (filename: string, size: number, seeders: number) => describe({
      infoHash: filename,
      __seeders: seeders,
      behaviorHints: { filename, videoSize: size },
    })
    const streamable = torrent(
      '[ASW] Masamune-kun no Revenge - 05 [1080p HEVC 10Bit].mkv',
      650 * 1024 ** 2,
      35,
    )
    const archival = torrent(
      '[smol] Masamune-kun no Revenge - S01E05 (BD 1080p HEVC Opus) [Dual Audio].mkv',
      2_252 * 1024 ** 2,
      150,
    )
    expect(scoreInfo(streamable, { directP2p: true }).score)
      .toBeGreaterThan(scoreInfo(archival, { directP2p: true }).score)
  })

  it('rewards dual audio, which is a real differentiator for anime', () => {
    expect(score('Show - 01 (1080p) [Dual Audio]')).toBeGreaterThan(score('Show - 01 (1080p)'))
  })

  it('rewards 10-bit and HEVC encodes', () => {
    expect(score('Show - 01 1080p HEVC 10bit')).toBeGreaterThan(score('Show - 01 1080p'))
  })

  it('rewards AV1 exactly as much as HEVC', () => {
    // Both are modern efficient codecs and libmpv decodes both, in hardware where the GPU
    // supports it and through the software fallback where it does not. Penalising AV1 would be
    // importing a browser-renderer problem this app does not have.
    expect(score('Show - 01 1080p AV1')).toBe(score('Show - 01 1080p HEVC'))
    expect(score('Show - 01 1080p AV1')).toBeGreaterThan(score('Show - 01 1080p x264'))
  })

  it('prefers BluRay over web, and sinks broadcast rips', () => {
    expect(score('Show - 01 1080p BluRay')).toBeGreaterThan(score('Show - 01 1080p WEB-DL'))
    expect(score('Show - 01 1080p WEB-DL')).toBeGreaterThan(score('Show - 01 1080p HDTV'))
  })

  it('sinks an ancient codec', () => {
    // Relative, not absolute: now that resolution contributes points, a total being negative says
    // nothing on its own. How far the penalty should reach across resolutions is not something the
    // reference takes a position on, so this only pins the direction.
    expect(score('Show - 01 1080p XviD')).toBeLessThan(score('Show - 01 1080p'))
  })

  it('rewards a known fansub group', () => {
    const trusted = TRUSTED_GROUPS[0]
    expect(score(`[${trusted}] Show - 01 (1080p)`)).toBeGreaterThan(score('[WhoKnows] Show - 01 (1080p)'))
  })

  it('strongly prefers the group the previous episode played from', () => {
    // Staying on one group across a binge keeps subtitle styling, naming and timing consistent —
    // it matters more than any single quality signal.
    const same = score('[Erai-raws] Show - 02 (1080p)', {}, { previousGroup: 'Erai-raws' })
    const other = score('[SubsPlease] Show - 02 (1080p) 👤 500', {}, { previousGroup: 'Erai-raws' })
    expect(same).toBeGreaterThan(other)
  })

  it('keeps release continuity as only a tie-breaker during direct P2P playback', () => {
    const ranked = scoreInfo(
      info('[Erai-raws] Show - 02 (1080p)', { infoHash: 'aabbcc', url: undefined }),
      { previousGroup: 'Erai-raws', directP2p: true },
    )
    expect(ranked.reasons).toContainEqual({ signal: 'same group as last episode', delta: 2 })
  })

  it('matches the previous group regardless of case and punctuation', () => {
    expect(score('[erai raws] Show - 02', {}, { previousGroup: 'Erai-raws' }))
      .toBe(score('[Erai-raws] Show - 02', {}, { previousGroup: 'Erai-raws' }))
  })

  it('buries a bare-hash source that nobody is seeding', () => {
    const dead = scoreInfo(describe({ infoHash: 'abc', title: 'Show - 01 (1080p) 👤 0' })).score
    const alive = scoreInfo(describe({ infoHash: 'abc', title: 'Show - 01 (1080p) 👤 200' })).score
    const worseButAlive = scoreInfo(describe({ infoHash: 'd', title: 'Show - 01 (720p) 👤 30' })).score
    // A dead 1080p must lose to a live 720p, or the list keeps leading with things that cannot play.
    expect(dead).toBeLessThan(alive)
    expect(dead).toBeLessThan(worseButAlive)
  })

  it('scores resolution, so it can be weighed against health rather than vetoing it', () => {
    expect(score('Show - 01 2160p')).toBeGreaterThan(score('Show - 01 1080p'))
    expect(score('Show - 01 1080p')).toBeGreaterThan(score('Show - 01 720p'))
  })

  it('lets a healthy 1080p outrank a barely-seeded 4K', () => {
    // The whole point: resolution as a hard key meant a 22-seeder 4K release always beat an
    // 812-seeder 1080p one, so the list led with things that would take an age to actually play.
    expect(score('Show - 01 1080p 👤 812')).toBeGreaterThan(score('Show - 01 2160p 👤 22'))
  })

  it('still prefers 4K when health is comparable', () => {
    expect(score('Show - 01 2160p 👤 400')).toBeGreaterThan(score('Show - 01 1080p 👤 400'))
  })
})
