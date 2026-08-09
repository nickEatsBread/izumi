// `requestIdleCallback` with a real fallback. Safari only shipped it in 16.4 and WebKitGTK — which
// is what the Deck and every Linux build actually run — is inconsistent about it, so the timeout
// path is load-bearing here, not defensive boilerplate.

type IdleHandle = { cancel: () => void }

interface IdleWindow {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

/**
 * Run `fn` once the main thread is idle, or after `timeout` ms — whichever comes first.
 * Used to keep boot-time warmers off the first-paint path without changing whether they run.
 */
export function idle(fn: () => void, timeout = 3000): IdleHandle {
  if (typeof window === 'undefined') return { cancel: () => {} }
  const w = window as unknown as IdleWindow
  if (typeof w.requestIdleCallback === 'function') {
    const id = w.requestIdleCallback(fn, { timeout })
    return { cancel: () => w.cancelIdleCallback?.(id) }
  }
  // Honour the caller's delay instead of clamping it. The clamp collapsed every boot warmer onto the
  // same ~1s tick, which is the whole stagger gone: on WebKitGTK — the Deck and every Linux build —
  // the id map's multi-megabyte download and parse, the extension workers, and the player chunk all
  // fired together while the home page was still loading its first covers. Harmless on a warm start,
  // brutal on a first-ever launch where nothing is cached. Callers pass a deliberate ordering
  // (3s/5s/6s); the fallback has to preserve it, since it IS the path on this platform.
  const id = setTimeout(fn, timeout)
  return { cancel: () => clearTimeout(id) }
}
