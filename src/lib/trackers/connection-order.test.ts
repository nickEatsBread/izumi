import { describe, expect, it } from 'vitest'
import {
  connectionOrderAfterLink,
  normalizeTrackerConnectionOrder,
  preferredConnectedTracker,
  type TrackerConnections,
} from './connection-order'

const none: TrackerConnections = { anilist: false, mal: false, kitsu: false, simkl: false }

describe('tracker connection order', () => {
  it('keeps only unique supported providers', () => {
    expect(normalizeTrackerConnectionOrder(['mal', 'unknown', 'mal', 'kitsu'])).toEqual(['mal', 'kitsu'])
  })

  it('preserves existing accounts before a newly linked account', () => {
    expect(connectionOrderAfterLink([], 'simkl', ['mal', 'kitsu'])).toEqual(['mal', 'kitsu', 'simkl'])
    expect(connectionOrderAfterLink(['kitsu', 'mal'], 'anilist', ['mal', 'kitsu'])).toEqual(['kitsu', 'mal', 'anilist'])
  })

  it('chooses the earliest linked account that is still connected', () => {
    expect(preferredConnectedTracker({ ...none, mal: true, kitsu: true }, ['kitsu', 'mal'])).toBe('kitsu')
    expect(preferredConnectedTracker({ ...none, mal: true, kitsu: true }, ['anilist', 'mal', 'kitsu'])).toBe('mal')
    expect(preferredConnectedTracker(none, ['mal'])).toBeUndefined()
  })
})
