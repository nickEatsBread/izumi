import { describe as suite, it, expect } from 'vitest'
import { scoreInfo, RESOLUTION_POINTS, TRUSTED_GROUPS, seederPoints, subtitleCompatibility } from './score'
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

  it('keeps community adoption visible above 100 seeders without making it linear', () => {
    expect(score('Show - 01 👤 100000')).toBeGreaterThan(score('Show - 01 👤 100'))
    expect(seederPoints(100_000)).toBe(19)
    expect(seederPoints(100_000)).toBeLessThan(20)
  })

  it('keeps materially healthier swarms distinct for direct P2P without making growth linear', () => {
    expect(seederPoints(28, true)).toBe(seederPoints(28, false))
    expect(seederPoints(1_000, true)).toBeGreaterThan(seederPoints(100, true))
    expect(seederPoints(1_000, true) - seederPoints(100, true)).toBe(3)
    expect(seederPoints(100_000, true)).toBe(19)
    expect(seederPoints(1_000, true) - seederPoints(100, true)).toBeLessThan(10)
  })

  it('does not over-reward a small swarm merely because its encode is compact', () => {
    const torrent = (filename: string, sizeMiB: number, seeders: number) => describe({
      infoHash: String(seeders),
      __seeders: seeders,
      behaviorHints: { filename, videoSize: sizeMiB * 1024 ** 2 },
    })
    const smallSwarm = torrent('[MiniDual] Show - 01 [1080p HEVC 10bit Dual Audio]', 333, 28)
    const healthy = torrent('[Erai-raws] Show - 01 [1080p HEVC]', 587, 117)
    expect(scoreInfo(healthy, { directP2p: true }).score)
      .toBeGreaterThan(scoreInfo(smallSwarm, { directP2p: true }).score)
  })

  it('prefers a similarly sized torrent with substantially more peers in direct P2P', () => {
    const torrent = (sizeMiB: number, seeders: number) => describe({
      infoHash: String(seeders),
      __seeders: seeders,
      behaviorHints: { filename: 'Show - 01 (1080p).mkv', videoSize: sizeMiB * 1024 ** 2 },
    })
    expect(scoreInfo(torrent(286, 1_134), { directP2p: true }).score)
      .toBeGreaterThan(scoreInfo(torrent(266, 268), { directP2p: true }).score)
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

  it('rewards explicit requested-subtitle evidence and rejects explicit foreign-only rows', () => {
    const english = info('[Erai-raws] Show - 01 [1080p][MultiSub].mkv')
    const french = info('Show S01E01 SUBFRENCH 1080p.mkv')
    expect(subtitleCompatibility(english, 'eng')).toBe('match')
    expect(subtitleCompatibility(french, 'eng')).toBe('mismatch')
    expect(scoreInfo(english, { subtitleLang: 'eng' }).score)
      .toBeGreaterThan(scoreInfo(french, { subtitleLang: 'eng' }).score)
  })

  it('does not pretend that a silent torrent filename proves subtitle availability', () => {
    expect(subtitleCompatibility(info('[Unknown] Show - 01 (1080p).mkv'), 'eng')).toBe('unknown')
  })

  it('prefers the previous group when the releases have comparable community support', () => {
    const same = score('[Erai-raws] Show - 02 (1080p) 👤 80', {}, { previousGroup: 'Erai-raws' })
    const other = score('[SubsPlease] Show - 02 (1080p) 👤 100', {}, { previousGroup: 'Erai-raws' })
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

  suite('adjacent resolution tiers', () => {
    // The budget a within-tier signal has to fit inside is the ADJACENT gap, never the 25 → 2
    // spread across the whole ladder — quoting the spread is how a weight that clears four
    // adjacent tiers reads as safe. Generated from RESOLUTION_POINTS so a new tier cannot quietly
    // go unasserted; the curated-release ordering these gaps govern is tested in candidates.test.ts.
    for (const [i, [higher]] of RESOLUTION_POINTS.entries()) {
      const lower = RESOLUTION_POINTS[i + 1]?.[0]
      if (!lower) continue
      it(`scores a plain ${higher}p above a plain ${lower}p`, () => {
        expect(score(`Show - 01 (${lower}p)`)).toBeLessThan(score(`Show - 01 (${higher}p)`))
      })
    }

    it('keeps continuity below the live community-health range', () => {
      const gaps = RESOLUTION_POINTS.slice(0, -1).map(([, p], i) => p - RESOLUTION_POINTS[i + 1][1])
      expect(gaps).toEqual([3, 2, 12, 6])
      const continuity = scoreInfo(info('[Erai-raws] Show - 02 (1080p)'), { previousGroup: 'Erai-raws' })
        .reasons.find((reason) => reason.signal === 'same group as last episode')?.delta
      expect(continuity).toBe(4)
      expect(seederPoints(100_000)).toBeGreaterThan(continuity!)
    })
  })
})
