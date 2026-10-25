/** Game mode: a touch on bare video only reveals the controls. WebKitGTK synthesizes that touch's
 *  pointer events after the reveal has mounted the controls, so they land on whatever is now under
 *  the finger: a tap low on the screen started a scrub on the seek bar and jumped the episode there.
 *  The overlay arms this while the revealing touch is still in progress; controls ignore its presses. */
let armedUntil = 0

export function armTouchReveal(ms = 900, now = performance.now()): void {
  armedUntil = now + ms
}

/** A new touch (or a drag, or the revealing touch's own click) ends the window. */
export function clearTouchReveal(): void {
  armedUntil = 0
}

export function touchRevealArmed(now = performance.now()): boolean {
  return now < armedUntil
}
