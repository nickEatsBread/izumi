import { describe, expect, it } from 'vitest'
import type { Media } from '$lib/anilist/types'
import { airedEpisodes } from './rules'

describe('automatic download scheduling', () => {
  it('returns only episodes that have aired', () => {
    const media = {
      id: 7, title: { romaji: 'Test' },
      airingSchedule: { nodes: [{ episode: 1, airingAt: 100 }, { episode: 2, airingAt: 200 }] },
    } as Media
    expect(airedEpisodes(media, 150)).toEqual([1])
  })

  it('uses the completed episode count when no schedule is available', () => {
    const media = { id: 7, title: { romaji: 'Test' }, status: 'FINISHED', episodes: 3 } as Media
    expect(airedEpisodes(media, 0)).toEqual([1, 2, 3])
  })
})
