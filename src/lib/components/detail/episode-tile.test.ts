import { describe, expect, it } from 'vitest'
import { episodeTileState, offlineResumeEpisode, playableThrough } from './episode-tile'

describe('episodeTileState', () => {
  it('marks everything up to the watched-through point as watched', () => {
    expect(episodeTileState({ ep: 3, watchedThrough: 6, aired: 12, percent: 0 }).kind).toBe('watched')
  })

  it('marks the first unwatched aired episode as the resume point', () => {
    expect(episodeTileState({ ep: 7, watchedThrough: 6, aired: 12, percent: 0 }).kind).toBe('resume')
  })

  it('reports partial progress on an episode that was left mid-way', () => {
    const state = episodeTileState({ ep: 8, watchedThrough: 6, aired: 12, percent: 42 })
    expect(state.kind).toBe('partial')
    expect(state.percent).toBe(42)
  })

  it('marks episodes past the aired count as unaired and unplayable', () => {
    const state = episodeTileState({ ep: 13, watchedThrough: 6, aired: 12, percent: 0 })
    expect(state.kind).toBe('unaired')
    expect(state.playable).toBe(false)
  })

  it('treats a fully-watched show as having no resume point', () => {
    expect(episodeTileState({ ep: 12, watchedThrough: 12, aired: 12, percent: 0 }).kind).toBe('watched')
  })
})

describe('playableThrough', () => {
  it('caps the aired count at the last listed episode', () => {
    expect(playableThrough([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 8, false)).toBe(8)
    expect(playableThrough([1, 2, 3], 12, false)).toBe(3)
    expect(playableThrough([1, 2, 3], Infinity, false)).toBe(0)
    expect(playableThrough([], 5, false)).toBe(0)
  })
  it('counts downloaded episodes offline', () => {
    expect(playableThrough([2, 5], 0, true)).toBe(5)
    expect(playableThrough([], 0, true)).toBe(0)
  })
})

// Offline, the series Play button and the Continue card open the same downloaded episode.
describe('offlineResumeEpisode', () => {
  it('opens the first downloaded episode past the progress', () => {
    expect(offlineResumeEpisode([1, 2, 5, 7], 2)).toBe(5)
    expect(offlineResumeEpisode([3, 4], 0)).toBe(3)
  })
  it('starts over from the first download once every download is watched', () => {
    expect(offlineResumeEpisode([1, 2, 3], 3)).toBe(1)
  })
  it('falls back to episode 1 with nothing downloaded', () => {
    expect(offlineResumeEpisode([], 4)).toBe(1)
  })
})
