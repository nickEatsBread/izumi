import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The Android Skip button tracked `currentSeg` directly, and an ED band runs to the end of the
// episode — so it sat pinned over the video for minutes with no way to dismiss it. The desktop
// overlay has always hidden it after ~5s unless the controls are up; this pins that parity.

const android = readFileSync(fileURLToPath(new URL('./AndroidPlayer.svelte', import.meta.url)), 'utf8')
const desktop = readFileSync(fileURLToPath(new URL('./PlayerOverlay.svelte', import.meta.url)), 'utf8')

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
    expect(android).toContain('!!currentSeg && willSkip(currentSeg) && !autoSkipped.has(currentSeg.start)')
  })
})
