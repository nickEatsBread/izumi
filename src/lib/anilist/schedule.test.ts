import { describe, it, expect } from 'vitest'
import { weekRange, groupByDay } from './schedule'
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
})
