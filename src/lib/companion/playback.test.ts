import { get } from 'svelte/store'
import { describe, expect, it } from 'vitest'
import { pendingCompanionPlayback } from './client'
import { cancelPendingCompanionPlayback, companionPlaybackEpisode, companionPlaybackMatches, companionPlaybackTarget, hasPendingCompanionPlayback } from './playback'
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

  it('opens the requested episode in the existing source picker', () => {
    const media = { id: 21, type: 'ANIME' as const }
    expect(companionPlaybackTarget(requested(3), media, 9)).toEqual({ episode: 3 })
    expect(companionPlaybackTarget(requested(), media, 9)).toEqual({ episode: 9 })
    expect(companionPlaybackTarget(requested(3), { ...media, id: 22 }, 9)).toBeNull()
  })

  it('supports a title-level movie target without inventing an episode', () => {
    expect(companionPlaybackTarget({
      ref: { provider: 'tmdb', type: 'movie', id: '550' },
      resolver: { streamType: 'movie' },
      title: 'Fight Club',
    }, {
      id: -1,
      format: 'MOVIE',
      catalog: { provider: 'tmdb', type: 'movie', id: '550' },
    })).toEqual({ episode: undefined })
  })

  it('maps a season-local TV episode past specials that appear first in provider metadata', () => {
    const request: CompanionMedia = {
      ref: { provider: 'stremio', type: 'series', id: 'skinwalker' },
      resolver: { streamType: 'series' },
      title: 'The Secret of Skinwalker Ranch',
      season: 1,
      episode: 1,
    }
    const resolved = {
      id: -1,
      type: 'SERIES' as const,
      format: 'TV',
      catalog: { provider: 'stremio' as const, type: 'series' as const, id: 'skinwalker' },
      videos: [
        { number: 1, season: 0, episode: 1, id: 'tt10589968:0:1' },
        { number: 2, season: 1, episode: 1, id: 'tt10589968:1:1' },
        { number: 3, season: 1, episode: 2, id: 'tt10589968:1:2' },
      ],
    }

    expect(companionPlaybackEpisode(request, resolved)).toBe(2)
    expect(companionPlaybackTarget(request, resolved)).toEqual({ episode: 2 })
    expect(companionPlaybackMatches(request, resolved, 2)).toBe(true)
    expect(companionPlaybackMatches(request, resolved, 1)).toBe(false)
  })

  it('rejects a missing season coordinate instead of silently playing another episode', () => {
    const request: CompanionMedia = {
      ref: { provider: 'tmdb', type: 'series', id: '101359' },
      title: 'The Secret of Skinwalker Ranch',
      season: 9,
      episode: 1,
    }
    const resolved = {
      id: -1,
      type: 'SERIES' as const,
      format: 'TV',
      catalog: { provider: 'tmdb' as const, type: 'series' as const, id: '101359' },
      videos: [{ number: 1, season: 1, episode: 1 }],
    }

    expect(companionPlaybackEpisode(request, resolved)).toBeNull()
    expect(companionPlaybackTarget(request, resolved)).toBeNull()
  })

  it('forgets a dismissed TV target so a later local play is not redirected', () => {
    pendingCompanionPlayback.set({
      device: {
        deviceId: 'tv-one',
        name: 'Living room TV',
        address: '192.168.1.40',
        credential: 'ab'.repeat(32),
        pairedAt: 1,
      },
      media: requested(3),
    })
    expect(cancelPendingCompanionPlayback()).toBe(true)
    expect(get(pendingCompanionPlayback)).toBeNull()
    expect(cancelPendingCompanionPlayback()).toBe(false)
  })

  it('redirects only the exact pending TV title and episode', () => {
    pendingCompanionPlayback.set({
      device: {
        deviceId: 'tv-one', name: 'Living room TV', address: '192.168.1.40',
        credential: 'ab'.repeat(32), pairedAt: 1,
      },
      media: requested(3),
    })
    expect(hasPendingCompanionPlayback({ id: 21, type: 'ANIME' }, 3)).toBe(true)
    expect(hasPendingCompanionPlayback({ id: 21, type: 'ANIME' }, 4)).toBe(false)
    pendingCompanionPlayback.set(null)
  })
})
