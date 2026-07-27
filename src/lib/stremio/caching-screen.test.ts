import { describe, expect, it } from 'vitest'
import { shouldShowCachingScreen, MIN_WAIT_BEFORE_SCREEN_MS } from './caching-screen'

const LATER = MIN_WAIT_BEFORE_SCREEN_MS + 1000

describe('shouldShowCachingScreen', () => {
  it('stays on the connecting screen for a torrent that is nearly done', () => {
    // The reported case: already cached at the service, so it materialises on the account with
    // progress racing to 100. The user saw connecting → a full-screen download report → playback,
    // for a download that was never going to happen.
    expect(shouldShowCachingScreen({ probes: 5, waitedMs: LATER, progress: 97 })).toBe(false)
  })

  it('shows for a genuine download that has barely started', () => {
    expect(shouldShowCachingScreen({ probes: 5, waitedMs: LATER, progress: 3 })).toBe(true)
  })

  it('waits out the opening probes, which are only milliseconds apart', () => {
    expect(shouldShowCachingScreen({ probes: 1, waitedMs: LATER, progress: 0 })).toBe(false)
  })

  it('waits for the delay to be real, however many probes have landed', () => {
    expect(shouldShowCachingScreen({ probes: 20, waitedMs: 500, progress: 0 })).toBe(false)
  })

  it('shows when the provider reports no progress at all but the wait is real', () => {
    // Several providers simply omit progress; silence is not evidence of being nearly finished.
    expect(shouldShowCachingScreen({ probes: 3, waitedMs: LATER })).toBe(true)
  })

  it('does not show the instant the threshold is crossed if it is finishing', () => {
    expect(shouldShowCachingScreen({ probes: 3, waitedMs: MIN_WAIT_BEFORE_SCREEN_MS, progress: 90 })).toBe(false)
    expect(shouldShowCachingScreen({ probes: 3, waitedMs: MIN_WAIT_BEFORE_SCREEN_MS, progress: 89 })).toBe(true)
  })
})
