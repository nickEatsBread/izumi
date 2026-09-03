import { beforeEach, describe, expect, it, vi } from 'vitest'

const anizip = vi.hoisted(() => ({ getEpisodeMeta: vi.fn() }))
const catalog = vi.hoisted(() => ({ loadCatalogProvider: vi.fn() }))
vi.mock('$lib/anizip', () => anizip)
vi.mock('$lib/catalog/registry', () => catalog)

import { createCompanionDetails } from './snapshot'
import type { CompanionMedia } from './protocol'

const media = (): CompanionMedia => ({
  ref: { provider: 'anilist', type: 'anime', id: '154587' },
  title: 'Frieren',
  episode: 2,
  episodeProgress: 0.4,
  seasonEpisodeCounts: [3],
})

describe('companion episode details', () => {
  beforeEach(() => {
    catalog.loadCatalogProvider.mockReset()
    anizip.getEpisodeMeta.mockReset().mockResolvedValue({
      1: { title: 'The Journey’s End', image: 'https://img.example/1.jpg', runtime: 25 },
      2: { title: 'It Didn’t Have to Be Magic', image: 'https://img.example/2.jpg', runtime: 24 },
      3: { title: 'Killing Magic', image: 'https://img.example/3.jpg', runtime: 26 },
    })
  })

  it('hydrates unique episode artwork and playback progress on demand', async () => {
    const details = await createCompanionDetails(media(), false)
    expect(anizip.getEpisodeMeta).toHaveBeenCalledWith(154587, 1)
    expect(details.episodes).toEqual([
      expect.objectContaining({ episode: 1, title: 'The Journey’s End', image: 'https://img.example/1.jpg', watched: true }),
      expect.objectContaining({ episode: 2, title: 'It Didn’t Have to Be Magic', image: 'https://img.example/2.jpg', progress: 0.4, watched: false }),
      expect.objectContaining({ episode: 3, title: 'Killing Magic', image: 'https://img.example/3.jpg', watched: false }),
    ])
  })

  it('marks every unwatched episode for the TV spoiler treatment', async () => {
    const details = await createCompanionDetails(media(), true)
    expect(details.episodes?.map((episode) => episode.spoiler)).toEqual([false, true, true])
  })

  it('loads provider-owned episode titles, summaries and thumbnails before replying to the TV', async () => {
    catalog.loadCatalogProvider.mockResolvedValue({
      detail: vi.fn().mockResolvedValue({
        id: -7,
        catalog: { provider: 'kitsu', id: '42', type: 'anime' },
        title: { userPreferred: 'Provider Series' },
        episodes: 2,
        duration: 24,
        videos: [
          { number: 1, episode: 1, title: 'Arrival', overview: 'The journey begins.', thumbnail: 'https://img.example/k1.jpg' },
          { number: 2, episode: 2, title: 'Departure', overview: 'The group sets out.', thumbnail: 'https://img.example/k2.jpg' },
        ],
      }),
    })
    const details = await createCompanionDetails({
      ref: { provider: 'kitsu', type: 'anime', id: '42' },
      title: 'Provider Series',
      episode: 2,
      episodeProgress: .25,
    }, false)

    expect(catalog.loadCatalogProvider).toHaveBeenCalledWith('kitsu')
    expect(details.seasonEpisodeCounts).toEqual([2])
    expect(details.episodes).toEqual([
      expect.objectContaining({ episode: 1, title: 'Arrival', description: 'The journey begins.', image: 'https://img.example/k1.jpg', watched: true }),
      expect.objectContaining({ episode: 2, title: 'Departure', description: 'The group sets out.', image: 'https://img.example/k2.jpg', progress: .25 }),
    ])
  })
})
