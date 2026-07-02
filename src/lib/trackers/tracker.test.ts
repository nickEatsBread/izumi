import { describe, it, expect } from 'vitest'
import { malStatus } from './index'
describe('malStatus', () => {
  it('maps AniList status enum to MAL', () => {
    expect(malStatus('CURRENT')).toBe('watching')
    expect(malStatus('PLANNING')).toBe('plan_to_watch')
    expect(malStatus('COMPLETED')).toBe('completed')
    expect(malStatus('PAUSED')).toBe('on_hold')
    expect(malStatus('DROPPED')).toBe('dropped')
  })
})
