/** A Svelte action that calls `onnear` once, the first time the node comes within one screen of the
 *  viewport (cards inside a scrolled-away part of a row wait until the row brings them into view). Without
 *  a callback it does nothing, so a card whose template binds no artwork never observes anything. */
export function nearViewport(node: Element, onnear?: () => void) {
  let observer: IntersectionObserver | undefined
  const start = (callback?: () => void) => {
    observer?.disconnect()
    observer = undefined
    if (!callback) return
    if (typeof IntersectionObserver === 'undefined') { callback(); return }
    const watcher = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      watcher.disconnect()
      if (observer === watcher) observer = undefined
      callback()
    }, { rootMargin: '100%' })
    observer = watcher
    watcher.observe(node)
  }
  start(onnear)
  return { update: start, destroy: () => observer?.disconnect() }
}
