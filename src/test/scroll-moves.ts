let inFrame = false

/** Runs the d-pad's eased scrolls (animateScroll in nav/anchor.ts) at once: each animation frame runs
 *  synchronously, a second after the last, so an eased scroll lands on its second frame. */
export function framesAtOnce(): void {
  let clock = 0
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    clock += 1000
    const outer = inFrame
    inFrame = true
    try {
      callback(clock)
    } finally {
      inFrame = outer
    }
    return 0
  }) as typeof window.requestAnimationFrame
}

/** The d-pad scrolls with absolute scrollTo writes (scrollByExact in nav/index.ts: WebKitGTK's own
 *  smooth scrolling falls short or flashes). Tests read each write as a move, the distance from where
 *  the target stood, as scrollBy was asked before; a write made inside an animation frame is part of
 *  an eased scroll: 'smooth'. A write that moves nothing (abortOngoingScroll stopping a running
 *  scroll, an eased scroll's first frame) is not a move: null. */
export function asMove(target: Window | HTMLElement, options: ScrollToOptions): ScrollToOptions | null {
  const [y, x] = target instanceof HTMLElement ? [target.scrollTop, target.scrollLeft] : [window.scrollY, window.scrollX]
  const top = (options.top ?? y) - y
  const left = (options.left ?? x) - x
  if (!top && !left) return null
  return { top, left, behavior: inFrame ? 'smooth' : options.behavior }
}
