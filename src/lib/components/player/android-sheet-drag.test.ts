import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Pulling the player's settings sheet down did nothing on a phone — not from the grab handle, not
// from the list — leaving a tap on the backdrop as the only way to close it. The pull logic was
// fine; it was being cancelled the instant it started.
//
// `lostpointercapture` bubbles, and touch/pen pointers are implicitly captured by whichever
// descendant the gesture began on. Taking capture on the sheet root therefore made the browser hand
// capture over from that descendant, and the resulting lostpointercapture bubbled straight into the
// sheet's own cancel handler. A mouse has no implicit capture, so nothing was ever handed over and
// the drag worked perfectly on a desktop — which is why this survived review.

const android = readFileSync(fileURLToPath(new URL('./AndroidPlayer.svelte', import.meta.url)), 'utf8')

describe('Android sheet drag survives implicit pointer capture', () => {
  it('only treats an element losing its OWN capture as a cancel', () => {
    expect(android).toContain('const isOwnCaptureLoss = (e: PointerEvent) => e.target === e.currentTarget')
  })

  it('routes the sheet through a lost-capture handler instead of cancelling outright', () => {
    expect(android).toContain('onlostpointercapture={handleLostCapture}')
    expect(android).toContain('if (!isOwnCaptureLoss(e)) { e.stopPropagation(); return }')
    // The old wiring — cancel on any bubbled loss — must not come back.
    expect(android).not.toContain('onlostpointercapture={handleCancel}')
  })

  it('guards the video surface and the timeline the same way', () => {
    expect(android).toContain('if (isOwnCaptureLoss(e) && rootPointerId === e.pointerId) onRootCancel(e)')
    expect(android).toContain('if (isOwnCaptureLoss(e) && barPointerId === e.pointerId) onBarCancel(e)')
  })

  it('does not re-capture a pointer the browser already captured', () => {
    expect(android).toContain('if (needsExplicitPointerCapture(e.pointerType)) {')
  })

  it('still lets a pull anywhere on the sheet dismiss it', () => {
    // The drag recogniser stays wired to the sheet ROOT, so the handle is decoration and the whole
    // surface is draggable — the behaviour the handle advertises.
    expect(android).toContain('onpointerdown={handleDown} onpointermove={handleMove}')
    expect(android).toContain('if (shouldDismissSheet(sheetDrag, releaseVelocity, window.innerHeight)) dismissSettings()')
  })
})
