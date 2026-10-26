/** The d-pad scrolls with absolute scrollTo calls (scrollByExact in nav/index.ts: WebKitGTK's smooth
 *  scrollBy falls short). Tests read each call as a move, the distance from where the target stood,
 *  as scrollBy was asked before. A behavior 'instant' call to where the target already stands is
 *  abortOngoingScroll stopping a running scroll, not a move: null. */
export function asMove(target: Window | HTMLElement, options: ScrollToOptions): ScrollToOptions | null {
  const [y, x] = target instanceof HTMLElement ? [target.scrollTop, target.scrollLeft] : [window.scrollY, window.scrollX]
  const top = (options.top ?? y) - y
  const left = (options.left ?? x) - x
  if (options.behavior === 'instant' && !top && !left) return null
  return { top, left, behavior: options.behavior }
}
