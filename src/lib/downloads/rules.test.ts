import { describe, expect, it } from 'vitest'
import type { Media } from '$lib/anilist/types'
import { airedEpisodes, dueAutoDownloadEpisodes } from './rules'

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

  it('waits for both a new episode and the configured release delay', () => {
    const media = {
      id: 7, title: { romaji: 'Test' },
      airingSchedule: { nodes: [{ episode: 1, airingAt: 100 }, { episode: 2, airingAt: 200 }] },
    } as Media
    expect(dueAutoDownloadEpisodes(media, 2, 205_000, 10)).toEqual([])
    expect(dueAutoDownloadEpisodes(media, 2, 800_000, 10)).toEqual([2])
  })

  it('does not treat older aired episodes as a new subscription download', () => {
    const media = { id: 7, title: { romaji: 'Test' }, status: 'FINISHED', episodes: 12 } as Media
    expect(dueAutoDownloadEpisodes(media, 13, 1_000_000, 0)).toEqual([])
  })
})
