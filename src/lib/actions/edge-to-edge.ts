/** Shared ownership of the `edge-to-edge` class on <html>.
 *
 *  The class removes `main`'s status-bar inset (see app.css) so a screen can paint under the status
 *  bar with its own bar. More than one screen wants that, and their lifetimes overlap: a keyed
 *  re-render can mount the next screen before the previous one tears down, and Svelte defers
 *  destruction while an out-transition runs. A bare add/remove in each screen therefore either
 *  strips the inset from a screen that still needs it, or leaves it stripped for screens that do
 *  not. Refcounting is the only shape that is correct under overlap.
 *
 *  The DOM target is a parameter so the counter can be tested without a DOM. */
export interface EdgeToEdgeTarget { classList: { add(token: string): void; remove(token: string): void } }

let users = 0

/** Take a share of the edge-to-edge state. Returns the release function; calling it twice is a
 *  no-op, so a teardown that runs more than once cannot drive the count negative. */
export function acquireEdgeToEdge(target?: EdgeToEdgeTarget): () => void {
  const root = target ?? (typeof document === 'undefined' ? undefined : document.documentElement)
  if (!root) return () => {}
  if (++users === 1) root.classList.add('edge-to-edge')
  let released = false
  return () => {
    if (released) return
    released = true
    if (--users === 0) root.classList.remove('edge-to-edge')
  }
}

/** Test seam: reset the shared counter between cases. */
export function resetEdgeToEdgeForTests(): void { users = 0 }
