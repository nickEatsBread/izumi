import { describe, it, expect } from 'vitest'
import { malStatus, aniScore, malScore } from './index'
import { kitsuScore, kitsuStatus, resolveKitsuId } from './kitsu'
import { simklScore, simklStatus } from './simkl'
describe('malStatus', () => {
  it('maps AniList status enum to MAL', () => {
    expect(malStatus('CURRENT')).toBe('watching')
    expect(malStatus('PLANNING')).toBe('plan_to_watch')
    expect(malStatus('COMPLETED')).toBe('completed')
    expect(malStatus('PAUSED')).toBe('on_hold')
    expect(malStatus('DROPPED')).toBe('dropped')
    expect(malStatus('REPEATING')).toBe('watching')
  })
})

describe('Kitsu mapping', () => {
  it('maps statuses and canonical scores to JSON:API values', () => {
    expect(kitsuStatus('PLANNING')).toBe('planned')
    expect(kitsuStatus('PAUSED')).toBe('on_hold')
    expect(kitsuStatus('REPEATING')).toBe('current')
    expect(kitsuScore(85)).toBe(17)
    expect(kitsuScore(0)).toBeNull()
  })

  it('uses a provider-native Kitsu id without treating the local compatibility key as AniList', async () => {
    await expect(resolveKitsuId({ kind: 'progress', mediaId: -123, idKitsu: 42 })).resolves.toBe(42)
  })
})

describe('Simkl mapping', () => {
  it('maps statuses and canonical scores to sync API values', () => {
    expect(simklStatus('PLANNING')).toBe('plantowatch')
    expect(simklStatus('PAUSED')).toBe('hold')
    expect(simklStatus('REPEATING')).toBe('watching')
    expect(simklScore(85)).toBe(9)
    expect(simklScore(0)).toBe(0)
  })
})

describe('score mapping (canonical 0-100)', () => {
  it('maps to AniList scoreRaw, clamped 0-100', () => {
    expect(aniScore(80)).toBe(80)
    expect(aniScore(150)).toBe(100)
    expect(aniScore(-5)).toBe(0)
    expect(aniScore(84.4)).toBe(84)
  })
  it('maps to MAL score, rounded + clamped 0-10', () => {
    expect(malScore(80)).toBe(8)
    expect(malScore(100)).toBe(10)
    expect(malScore(0)).toBe(0)
    expect(malScore(75)).toBe(8) // 7.5 → 8
    expect(malScore(74)).toBe(7)
    expect(malScore(200)).toBe(10)
  })
})
