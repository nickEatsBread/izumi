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

  it('rewards dual audio, which is a real differentiator for anime', () => {
    expect(score('Show - 01 (1080p) [Dual Audio]')).toBeGreaterThan(score('Show - 01 (1080p)'))
  })

  it('rewards 10-bit and HEVC encodes', () => {
    expect(score('Show - 01 1080p HEVC 10bit')).toBeGreaterThan(score('Show - 01 1080p'))
  })

  it('prefers BluRay over web, and sinks broadcast rips', () => {
    expect(score('Show - 01 1080p BluRay')).toBeGreaterThan(score('Show - 01 1080p WEB-DL'))
    expect(score('Show - 01 1080p WEB-DL')).toBeGreaterThan(score('Show - 01 1080p HDTV'))
  })

  it('sinks an ancient codec hard', () => {
    expect(score('Show - 01 1080p XviD')).toBeLessThan(0)
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

  it('matches the previous group regardless of case and punctuation', () => {
    expect(score('[erai raws] Show - 02', {}, { previousGroup: 'Erai-raws' }))
      .toBe(score('[Erai-raws] Show - 02', {}, { previousGroup: 'Erai-raws' }))
  })

  it('buries a bare-hash source that nobody is seeding', () => {
    const dead = scoreInfo(describe({ infoHash: 'abc', title: 'Show - 01 (1080p) 👤 0' }))
    expect(dead.score).toBeLessThan(-10)
  })

  it('does not score resolution — the tier is decided before the score is consulted', () => {
    expect(score('Show - 01 2160p')).toBe(score('Show - 01 1080p'))
  })
})
