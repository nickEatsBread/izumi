import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { get } from 'svelte/store'

import { durableHistory, recordPlay, recordProgress, historyEpisodeOf, sessionProgress } from './history'
import { saveLocalHistory } from '$lib/settings/ui'
import { incognito } from '$lib/stores/incognito'
import type { Media } from '$lib/anilist/types'

// A catalog movie plays with NO episode number (playEpisode passes undefined); a series always
// carries one. History must still record the film — as its single episode, with finite counts.
const film = (id = -42): Media => ({
  id,
  type: 'MOVIE',
  format: 'MOVIE',
  episodes: 1,
  title: { romaji: 'Some Film', english: 'Some Film', userPreferred: 'Some Film' },
  catalog: { provider: 'stremio', type: 'movie', id: 'tt0111161', addonId: 'addon1', resourceType: 'movie' },
} as unknown as Media)

const series = (id = 101): Media => ({ id, title: { romaji: 'Show' }, episodes: 12 } as Media)

const reset = () => {
  incognito.set(false)
  saveLocalHistory.set(true)
  durableHistory.set({})
  sessionProgress.set({})
}

describe('movie watch history', () => {
  beforeEach(reset)
  afterEach(reset)

  it('resolves a missing episode number to the movie\'s single episode, never for series', () => {
    expect(historyEpisodeOf(film(), undefined)).toBe(1)
    expect(historyEpisodeOf(film(), 1)).toBe(1)
    expect(historyEpisodeOf(series(), undefined)).toBeUndefined()
    expect(historyEpisodeOf(series(), 4)).toBe(4)
  })

  it('records an opened film in durable history so it appears in the settings log', () => {
    recordPlay(film(), undefined, { group: 'Example' })
    const entry = get(durableHistory)[-42]
    expect(entry).toBeDefined()
    expect(entry!.episode).toBe(1)
    expect(entry!.progress).toBe(0)
    expect(entry!.release).toEqual({ group: 'Example' })
    expect(entry!.catalogSelection).toBe('stremio')
  })

  it('records a finished film with a finite watched count (no NaN from the missing episode)', () => {
    recordPlay(film(), undefined)
    recordProgress(film(), undefined as unknown as number)
    const entry = get(durableHistory)[-42]
    expect(entry!.episode).toBe(1)
    expect(entry!.progress).toBe(1)
    expect(Number.isFinite(entry!.progress)).toBe(true)
    expect(get(sessionProgress)[-42]).toBe(1)
  })

  it('still skips recording when a series is opened without an episode', () => {
    recordPlay(series(), undefined)
    expect(get(durableHistory)).toEqual({})
  })
})
