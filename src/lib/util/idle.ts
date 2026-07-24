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
  const id = setTimeout(fn, Math.min(timeout, 1000))
  return { cancel: () => clearTimeout(id) }
}
