import { describe, it, expect } from 'vitest'
import { weekRange, groupByDay, aired, until } from './schedule'
describe('schedule helpers', () => {
  it('weekRange returns 7-day [start,end] unix seconds', () => {
    const { start, end } = weekRange(new Date('2026-07-02T12:00:00Z'))
    expect(end - start).toBe(7 * 24 * 3600)
  })
  it('groupByDay buckets airings into 7 day-arrays', () => {
    const start = Math.floor(new Date('2026-06-29T00:00:00Z').getTime() / 1000)
    const items = [{ airingAt: start + 3600, episode: 1, media: { id: 1 } }, { airingAt: start + 24*3600 + 3600, episode: 2, media: { id: 2 } }]
    const days = groupByDay(items as any, start)
    expect(days[0].length).toBe(1); expect(days[1].length).toBe(1); expect(days.length).toBe(7)
  })
  it('aired() is true at or after the airing time', () => {
    const t = 1_000_000 // unix seconds
    expect(aired(t, t * 1000)).toBe(true) // exactly now
    expect(aired(t, t * 1000 + 1000)).toBe(true) // 1s after
    expect(aired(t, t * 1000 - 1000)).toBe(false) // 1s before
  })
  it('until() formats the countdown by magnitude', () => {
    const t = 1_000_000
    const nowMs = t * 1000
    expect(until(t, nowMs)).toBe('') // already aired
    expect(until(t, nowMs - 30 * 60_000)).toBe('in 30m') // 30 min out
    expect(until(t, nowMs - 5 * 3_600_000)).toBe('in 5h') // 5 h out
    expect(until(t, nowMs - 3 * 24 * 3_600_000)).toBe('in 3d') // 3 d out
  })
})
