import { describe, expect, it } from 'vitest'
import { scheduleCardNav } from './schedule-nav'

describe('selected-day schedule navigation', () => {
  it('links each two-column row horizontally without involving the weekday strip', () => {
    expect(scheduleCardNav('schedule-first-airing', 0, 4)).toEqual({
      id: 'schedule-first-airing', left: undefined, right: 'schedule-first-airing-1',
    })
    expect(scheduleCardNav('schedule-first-airing', 1, 4)).toEqual({
      id: 'schedule-first-airing-1', left: 'schedule-first-airing', right: undefined,
    })
    expect(scheduleCardNav('schedule-first-airing', 2, 4)).toEqual({
      id: 'schedule-first-airing-2', left: undefined, right: 'schedule-first-airing-3',
    })
  })

  it('does not invent a right neighbour for an unpaired final card', () => {
    expect(scheduleCardNav('schedule-first-airing', 2, 3).right).toBeUndefined()
  })

  it('leaves ordinary day columns on geometric navigation', () => {
    expect(scheduleCardNav(undefined, 0, 2)).toEqual({})
  })
})
