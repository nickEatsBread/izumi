/** A loading shimmer (`.skeloader::before`, `skeleton-swipe`) sweeps until its content arrives, and
 *  a lazy cover far down Home never arrives while it stays off screen: on the Deck's Home 123 sweeps
 *  ran below the fold, about 40% of a core across WebKit, Xwayland and gamescope. Each shimmer is
 *  picked up as its animation starts and marked `data-offscreen` while it is out of view, which
 *  app.css pauses. The sweep runs as before wherever it can be seen. */
export function pauseOffscreenShimmer(root: EventTarget = document) {
  const seen = new WeakSet<Element>()
  // The margin resumes a sweep just before it scrolls in: observer callbacks land a frame late.
  const observer = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      // Removed: forget it, so a re-inserted node (its animation starts again) is observed afresh.
      if (!target.isConnected) { observer.unobserve(target); seen.delete(target); continue }
      target.toggleAttribute('data-offscreen', !isIntersecting)
    }
  }, { rootMargin: '100px' })
  // Animation events from `::before` are dispatched on its element and bubble.
  const onStart = (event: Event) => {
    const target = event.target
    if ((event as AnimationEvent).animationName !== 'skeleton-swipe' || !(target instanceof Element) || seen.has(target)) return
    seen.add(target)
    observer.observe(target)
  }
  root.addEventListener('animationstart', onStart)
  return () => {
    root.removeEventListener('animationstart', onStart)
    observer.disconnect()
  }
}
