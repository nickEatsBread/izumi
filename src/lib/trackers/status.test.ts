import { describe, it, expect } from 'vitest'
import { STATUS_ORDER, STATUS_LABEL, STATUS_COLOR, malToAni, mergedProgress, scoreLabel } from './status'
import { malStatus, type AniStatus } from './index'

describe('status maps', () => {
  it('has a label + color for every status in the picker', () => {
    for (const s of STATUS_ORDER) {
      expect(STATUS_LABEL[s]).toBeTruthy()
      expect(STATUS_COLOR[s]).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('covers all six AniStatus values', () => {
    expect([...STATUS_ORDER].sort()).toEqual(
      ['COMPLETED', 'CURRENT', 'DROPPED', 'PAUSED', 'PLANNING', 'REPEATING'],
    )
  })
})

describe('malToAni', () => {
  it('reverses malStatus for every non-rewatch status', () => {
    // REPEATING has no distinct MAL status (it maps to watching via is_rewatching), so skip it.
    const statuses: AniStatus[] = ['CURRENT', 'PLANNING', 'COMPLETED', 'PAUSED', 'DROPPED']
    for (const s of statuses) {
      expect(malToAni(malStatus(s))).toBe(s)
    }
  })

  it('maps MAL on_hold → PAUSED and returns undefined for unknown/empty', () => {
    expect(malToAni('on_hold')).toBe('PAUSED')
    expect(malToAni('')).toBeUndefined()
    expect(malToAni(undefined)).toBeUndefined()
    expect(malToAni('nonsense')).toBeUndefined()
  })
})

describe('mergedProgress', () => {
  it('takes the higher tracker when both report progress', () => {
    expect(mergedProgress(7, 3)).toBe(7)
    expect(mergedProgress(3, 7)).toBe(7)
  })
  it('does NOT let an AniList progress of 0 hide MAL progress', () => {
    // Regression: `rawEntry?.progress ?? malEntry?.progress` — 0 is not nullish, so a fresh
    // AniList entry at 0 silently swallowed real MAL progress. MAL is canonical; take the max.
    expect(mergedProgress(0, 12)).toBe(12)
  })
  it('falls back to whichever tracker has a value', () => {
    expect(mergedProgress(undefined, 4)).toBe(4)
    expect(mergedProgress(2, undefined)).toBe(2)
    expect(mergedProgress(null, null)).toBe(0)
    expect(mergedProgress(undefined, undefined)).toBe(0)
  })
})

describe('scoreLabel', () => {
  it('maps the 0-10 scale to descriptive labels', () => {
    expect(scoreLabel(0)).toBe('Not rated')
    expect(scoreLabel(4)).toBe('Bad')
    expect(scoreLabel(10)).toBe('Masterpiece')
  })
  it('rounds and clamps out-of-range input', () => {
    expect(scoreLabel(7.4)).toBe('Good')
    expect(scoreLabel(-3)).toBe('Not rated')
    expect(scoreLabel(99)).toBe('Masterpiece')
  })
})
