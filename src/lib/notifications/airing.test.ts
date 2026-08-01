import { describe, expect, it } from 'vitest'
import { airingNotificationId, notificationPlan } from './airing'

describe('airing notifications', () => {
  it('uses stable distinct positive ids', () => {
    expect(airingNotificationId(1, 2)).toBe(airingNotificationId(1, 2))
    expect(airingNotificationId(1, 2)).not.toBe(airingNotificationId(1, 3))
    expect(airingNotificationId(1, 2)).toBeGreaterThanOrEqual(0)
  })

  it('plans only future airings and applies the lead time', () => {
    const now = 2_000_000_000_000
    const history = {
      7: {
        media: { id: 7, title: { english: 'Example' }, airingSchedule: { nodes: [
          { episode: 2, airingAt: (now - 1_000) / 1000 },
          { episode: 3, airingAt: (now + 3_600_000) / 1000 },
        ] } },
        progress: 1,
        updatedAt: now,
      },
    } as any
    expect(notificationPlan(history, now, 10)).toEqual([expect.objectContaining({ episode: 3, at: now + 3_000_000, title: 'Example' })])
  })
})
