import { describe, expect, it } from 'vitest'
import { pickCandidates, pickBest } from './addon'

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
