import { describe, expect, it } from 'vitest'
import { episodeTileState } from './episode-tile'

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
