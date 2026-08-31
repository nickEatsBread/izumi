import { describe, expect, it } from 'vitest'
import { companionPlaybackMatches } from './playback'
import type { CompanionMedia } from './protocol'

const requested = (episode?: number): CompanionMedia => ({
  ref: { provider: 'anilist', type: 'anime', id: '21' },
  title: 'One Piece',
  episode,
})

describe('companion playback target', () => {
  it('matches only the title and requested episode opened by the TV', () => {
    const media = { id: 21, type: 'ANIME' as const }
    expect(companionPlaybackMatches(requested(3), media, 3)).toBe(true)
    expect(companionPlaybackMatches(requested(3), media, 4)).toBe(false)
    expect(companionPlaybackMatches(requested(3), { ...media, id: 22 }, 3)).toBe(false)
  })

  it('allows episode selection when the TV requested a title without a specific episode', () => {
    expect(companionPlaybackMatches(requested(), { id: 21, type: 'ANIME' }, 9)).toBe(true)
  })
})
