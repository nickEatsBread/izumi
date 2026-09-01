import { describe, expect, it } from 'vitest'
import type { Media } from '$lib/anilist/types'
import { releaseMoment, videoAirings } from './personal'

const media = {
  id: -10,
  type: 'SERIES',
  format: 'TV',
  title: { userPreferred: 'Example series' },
  catalog: { provider: 'tmdb', type: 'series', id: '10' },
} as Media

describe('personal provider schedule', () => {
  it('keeps date-only releases on the viewer local day without claiming a time', () => {
    const moment = releaseMoment('2026-09-03')
    expect(moment?.timeKnown).toBe(false)
    const date = new Date((moment?.airingAt ?? 0) * 1000)
    expect([date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours()])
      .toEqual([2026, 9, 3, 12])
  })

  it('preserves real ISO release times', () => {
    const moment = releaseMoment('2026-09-03T20:30:00.000Z')
    expect(moment).toEqual({
      airingAt: Date.parse('2026-09-03T20:30:00.000Z') / 1000,
      timeKnown: true,
    })
  })

  it('rejects invalid calendar dates instead of rolling them into another month', () => {
    expect(releaseMoment('2026-02-31')).toBeNull()
  })

  it('maps only videos inside the requested week and keeps season coordinates', () => {
    const start = new Date(2026, 8, 1).getTime() / 1000
    const end = new Date(2026, 8, 8).getTime() / 1000
    const result = videoAirings(media, [
      { id: 'old', number: 7, season: 2, episode: 1, released: '2026-08-31' },
      { id: 'new', number: 8, season: 2, episode: 2, released: '2026-09-03' },
    ], start, end)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      episode: 8,
      season: 2,
      providerEpisode: 2,
      source: 'tmdb',
      kind: 'episode',
      timeKnown: false,
    })
  })
})
