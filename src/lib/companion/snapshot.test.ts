import { beforeEach, describe, expect, it, vi } from 'vitest'

const anizip = vi.hoisted(() => ({ getEpisodeMeta: vi.fn() }))
vi.mock('$lib/anizip', () => anizip)

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
})
