import { describe, expect, it } from 'vitest'
import { rdAccountInfo } from './providers/realdebrid'
import { adAccountInfo } from './providers/alldebrid'
import { pmAccountInfo } from './providers/premiumize'
import { tbAccountInfo } from './providers/torbox'

describe('debrid account snapshots', () => {
  it('maps Real-Debrid expiry and points', () => {
    expect(rdAccountInfo({ username: 'mei', type: 'premium', expiration: '2032-06-06T04:42:42.000Z', points: 12 }))
      .toEqual({ username: 'mei', plan: 'premium', premiumUntil: Date.parse('2032-06-06T04:42:42.000Z'), points: 12 })
  })

  it('maps AllDebrid premium timestamps from seconds', () => {
    expect(adAccountInfo({ username: 'rei', isPremium: true, premiumUntil: '2000000000', fidelityPoints: 9 }))
      .toEqual({ username: 'rei', plan: 'premium', premiumUntil: 2_000_000_000_000, points: 9 })
  })

  it('clamps Premiumize fair-use fraction', () => {
    expect(pmAccountInfo({ customer_id: 42, premium_until: 2_000_000_000, limit_used: 1.5, booster_points: 3 }))
      .toEqual({ username: '42', plan: 'premium', premiumUntil: 2_000_000_000_000, quotaUsed: 1, points: 3 })
  })

  it('maps TorBox user data, plan ids, expiry, and transfer usage', () => {
    expect(tbAccountInfo({
      email: 'asuka@example.com',
      plan: 3,
      is_subscribed: true,
      premium_expires_at: '2032-06-06T04:42:42.000Z',
      total_downloaded: 1_610_612_736,
    })).toEqual({
      username: 'asuka@example.com',
      plan: 'standard',
      premiumUntil: Date.parse('2032-06-06T04:42:42.000Z'),
      downloadedBytes: 1_610_612_736,
    })
  })
})
