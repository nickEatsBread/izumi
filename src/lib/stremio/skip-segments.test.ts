import { describe, expect, it, vi } from 'vitest'
import type { Media } from '$lib/anilist/types'

vi.mock('./aniskip', async (original) => ({
  ...await original<typeof import('./aniskip')>(),
  getSkipSegments: vi.fn(async () => [
    { start: 85, end: 175, type: 'op', label: 'Opening' },
    { start: 1_310, end: 1_400, type: 'ed', label: 'Ending' },
  ]),
}))
vi.mock('./introdb', () => ({
  getIntroDbSegments: vi.fn(async () => [{ start: 1_400, end: 1_420, type: 'preview', label: 'Preview' }]),
}))

const { getMediaSkipSegments, mergeRemoteSkipSegments, sourceSkipSegments } = await import('./skip-segments')

describe('remote skip source priority', () => {
  it('prefers AniSkip on overlap and fills missing segment types from IntroDB', () => {
    const merged = mergeRemoteSkipSegments(
      [{ start: 60, end: 150, type: 'op', label: 'Opening' }],
      [
        { start: 65, end: 145, type: 'op', label: 'Opening' },
        { start: 1_300, end: 1_390, type: 'ed', label: 'Ending' },
      ],
    )
    expect(merged).toEqual([
      { start: 60, end: 150, type: 'op', label: 'Opening' },
      { start: 1_300, end: 1_390, type: 'ed', label: 'Ending' },
    ])
  })
})

describe('skip markers a stream supplies', () => {
  it('maps the source types onto the player segments and marks the credits', () => {
    expect(sourceSkipSegments([
      { type: 'credits', start: 1_300, end: 1_390 },
      { type: 'intro', start: 90, end: 180 },
      { type: 'recap', start: 0, end: 30 },
      { type: 'preview', start: 1_390, end: 1_420 },
    ])).toEqual([
      { start: 0, end: 30, type: 'recap', label: 'Recap' },
      { start: 90, end: 180, type: 'op', label: 'Opening' },
      { start: 1_300, end: 1_390, type: 'ed', label: 'Ending', credits: true },
      { start: 1_390, end: 1_420, type: 'preview', label: 'Preview' },
    ])
  })

  it('drops whatever is not a known type with finite times inside a plausible file', () => {
    expect(sourceSkipSegments([
      { type: 'intro', start: '90', end: 180 },
      { type: 'intro', start: Number.NaN, end: 180 },
      { type: 'intro', start: -1, end: 180 },
      { type: 'intro', start: 180, end: 180 },
      { type: 'intro', start: 200, end: 100 },
      { type: 'credits', start: 0, end: Number.POSITIVE_INFINITY },
      { type: 'credits', start: 0, end: 13 * 60 * 60 },
      { type: 'outro', start: 10, end: 20 },
      { type: 'constructor', start: 10, end: 20 },
      { type: '__proto__', start: 10, end: 20 },
      null,
      'intro',
      42,
    ])).toEqual([])
    expect(sourceSkipSegments({ type: 'intro', start: 1, end: 2 })).toEqual([])
    expect(sourceSkipSegments(undefined)).toEqual([])
  })

  it('reads a bounded number of markers', () => {
    const many = Array.from({ length: 100 }, (_, index) => ({ type: 'intro', start: index * 10, end: index * 10 + 5 }))
    expect(sourceSkipSegments(many)).toHaveLength(32)
  })

  it('wins over AniSkip and IntroDB where they overlap and lets them fill the rest', async () => {
    const own = sourceSkipSegments([
      { type: 'intro', start: 90, end: 180 },
      { type: 'credits', start: 1_300, end: 1_390 },
    ])
    const merged = await getMediaSkipSegments({ idMal: 1 } as Media, 1, 1_440, own)
    expect(merged).toEqual([
      { start: 90, end: 180, type: 'op', label: 'Opening' },
      { start: 1_300, end: 1_390, type: 'ed', label: 'Ending', credits: true },
      { start: 1_400, end: 1_420, type: 'preview', label: 'Preview' },
    ])
  })
})
