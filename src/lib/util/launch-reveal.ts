/** The class the Rust launch script puts on <html> under Gamescope. `app.css` hides the body while
 *  it is present, so the document paints only once the frontend has applied the persisted Deck page
 *  zoom — otherwise launch visibly grows from 1x. */
export const DECK_LAUNCH_PENDING = 'deck-launch-pending'

export interface RevealDocument {
  visibilityState: string
  documentElement: { classList: { contains: (name: string) => boolean } }
  addEventListener: (type: string, listener: () => void) => void
  removeEventListener: (type: string, listener: () => void) => void
}

export interface RevealWindow {
  requestAnimationFrame: (callback: () => void) => number
  cancelAnimationFrame?: (handle: number) => void
  MutationObserver?: new (callback: () => void) => {
    observe: (target: unknown, options: { attributes: boolean; attributeFilter: string[] }) => void
    disconnect: () => void
  }
}

/**
 * Whether the document is genuinely in front of the user.
 *
 * Two separate gates have to be open, and on a Steam Deck launch neither is open at mount: the
 * window itself is created hidden and shown on page load, and under Gamescope the body stays
 * `visibility: hidden` until the native page zoom has been applied over IPC.
 */
export function launchRevealed(doc: RevealDocument): boolean {
  return doc.visibilityState === 'visible'
    && !doc.documentElement.classList.contains(DECK_LAUNCH_PENDING)
}

export interface RevealOptions {
  doc?: RevealDocument
  win?: RevealWindow
  /** Last resort: start anyway rather than never, if a gate is somehow never released. */
  timeoutMs?: number
}

/**
 * Run `start` on the first frame the user can actually see.
 *
 * Anything timed — a CSS animation, a duration timer — that begins at mount instead spends its
 * opening on a hidden surface, and the viewer joins it midway through. Waiting for the real reveal
 * keeps the whole sequence on screen without lengthening it by a single millisecond.
 *
 * Returns a cancel function; `start` runs at most once.
 */
export function onLaunchRevealed(start: () => void, options: RevealOptions = {}): () => void {
  const doc = options.doc ?? (typeof document === 'undefined' ? undefined : (document as unknown as RevealDocument))
  const win = options.win ?? (typeof window === 'undefined' ? undefined : (window as unknown as RevealWindow))
  if (!doc || !win) {
    start()
    return () => {}
  }

  // `armed` stops a second gate change from queueing the start twice; `disposed` stops an already
  // queued start from running for a component that has since gone away.
  let armed = false
  let disposed = false
  let observer: InstanceType<NonNullable<RevealWindow['MutationObserver']>> | undefined
  let safety: ReturnType<typeof setTimeout> | undefined
  const onVisibility = () => check()

  const cleanup = () => {
    doc.removeEventListener('visibilitychange', onVisibility)
    observer?.disconnect()
    observer = undefined
    if (safety !== undefined) clearTimeout(safety)
    safety = undefined
  }

  const arm = () => {
    if (armed || disposed) return
    armed = true
    cleanup()
    // Two frames: the first is the one the reveal itself is painted in, the second is the first
    // frame an animation started here can actually occupy.
    win.requestAnimationFrame(() => win.requestAnimationFrame(() => {
      if (!disposed) start()
    }))
  }

  function check() {
    if (launchRevealed(doc!)) arm()
  }

  if (launchRevealed(doc)) {
    arm()
    return () => { disposed = true }
  }

  doc.addEventListener('visibilitychange', onVisibility)
  if (win.MutationObserver) {
    observer = new win.MutationObserver(check)
    observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['class'] })
  }
  safety = setTimeout(arm, options.timeoutMs ?? 6000)

  return () => {
    disposed = true
    cleanup()
  }
}
