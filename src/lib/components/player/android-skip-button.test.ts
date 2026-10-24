import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The Android Skip button tracked `currentSeg` directly, and an ED band runs to the end of the
// episode — so it sat pinned over the video for minutes with no way to dismiss it. The desktop
// overlay has always hidden it after ~5s unless the controls are up; this pins that parity.

const android = readFileSync(fileURLToPath(new URL('./AndroidPlayer.svelte', import.meta.url)), 'utf8')
const desktop = readFileSync(fileURLToPath(new URL('./PlayerOverlay.svelte', import.meta.url)), 'utf8')

describe('skipping without clicking', () => {
  it('lets the TV remote OK skip while the prompt is up, before it can pause', () => {
    const skip = android.indexOf("if (!controlsShown && event.key === 'Enter' && showSkip) {")
    expect(skip).toBeGreaterThan(-1)
    expect(skip).toBeLessThan(android.indexOf("if (event.key === 'Enter') pressPause()"))
  })

  it('gives the desktop skip key to the player only inside a segment', () => {
    expect(desktop).toContain("if (action === 'playerSkipSegment' && !currentSeg) return")
    expect(desktop).toContain("else if (action === 'playerSkipSegment' && currentSeg) seekTo(currentSeg.end + 0.5)")
  })
})

describe('Android skip button auto-hide', () => {
  it('hides itself on a timer like the desktop overlay', () => {
    expect(android).toContain('let skipTimer = $state(false)')
    expect(android).toContain('skipT = setTimeout(() => (skipTimer = false), 5000)')
    // Same window as desktop, so the two players behave identically.
    expect(desktop).toContain('setTimeout(() => (skipTimer = false), 5000)')
  })

  it('comes back while the controls are up', () => {
    expect(android).toContain('(skipTimer || controlsShown)')
  })

  it('renders off the gated flag, not the raw segment', () => {
    expect(android).toContain('{#if showSkip && currentSeg}')
  })

  it('still suppresses the button for a segment that will auto-skip', () => {
    expect(android).toContain('&& !autoSkipped.has(currentSeg.start)')
    expect(android).toContain('&& !autoSkipFailed.has(currentSeg.start)')
  })

  it('honours auto-skip for every detected segment on both players', () => {
    // Type is the only thing allowed to gate a skip, and only for the next-episode preview, which
    // opts in separately. Nothing may filter by occurrence: skipping the first OP but not a second
    // one is the regression `firstOccurrences` used to cause.
    const gate = 'const willSkip = (segment: Segment) => $autoSkip && (segment.type !== \'preview\' || $skipPreviews)'
    expect(android).toContain(gate)
    expect(desktop).toContain(gate)
    expect(android).not.toContain('firstOccurrences')
    expect(desktop).not.toContain('firstOccurrences')
  })

  it('only marks a segment handled after its automatic seek succeeds', () => {
    expect(android).toContain('.then(() => {')
    expect(android).toContain('autoSkipped = new Set(autoSkipped).add(seg.start)')
    expect(desktop).toContain('if (success) autoSkipped = new Set(autoSkipped).add(seg.start)')
    expect(android).toContain('autoSkipFailed = new Set(autoSkipFailed).add(seg.start)')
    expect(desktop).toContain('autoSkipFailed = new Set(autoSkipFailed).add(seg.start)')
  })
})
