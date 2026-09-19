import { afterEach, describe, expect, it, vi } from 'vitest'
import { DECK_LAUNCH_PENDING, launchRevealed, onLaunchRevealed, type RevealDocument, type RevealWindow } from './launch-reveal'

function host(initial: { visibility?: string; pending?: boolean } = {}) {
  let visibility = initial.visibility ?? 'visible'
  let pending = initial.pending ?? false
  const listeners = new Set<() => void>()
  const observers = new Set<() => void>()
  const frames: (() => void)[] = []

  const doc: RevealDocument = {
    get visibilityState() { return visibility },
    documentElement: { classList: { contains: (name: string) => name === DECK_LAUNCH_PENDING && pending } },
    addEventListener: (_type, listener) => { listeners.add(listener) },
    removeEventListener: (_type, listener) => { listeners.delete(listener) },
  }

  const win: RevealWindow = {
    requestAnimationFrame: (callback) => { frames.push(callback); return frames.length },
    MutationObserver: class {
      constructor(private readonly callback: () => void) {}
      observe() { observers.add(this.callback) }
      disconnect() { observers.delete(this.callback) }
    } as unknown as RevealWindow['MutationObserver'],
  }

  return {
    doc,
    win,
    get listenerCount() { return listeners.size },
    get observerCount() { return observers.size },
    /** Drain the frame queue the way a browser would: callbacks queued during a frame wait. */
    frame() { frames.splice(0, frames.length).forEach((callback) => callback()) },
    reveal() { pending = false; observers.forEach((callback) => callback()) },
    hold() { pending = true; observers.forEach((callback) => callback()) },
    show() { visibility = 'visible'; listeners.forEach((listener) => listener()) },
    hide() { visibility = 'hidden'; listeners.forEach((listener) => listener()) },
  }
}

afterEach(() => { vi.useRealTimers() })

describe('launchRevealed', () => {
  it.each([
    ['visible with no gate', 'visible', false, true],
    ['visible but still waiting on the Deck page zoom', 'visible', true, false],
    ['hidden window, gate already lifted', 'hidden', false, false],
    ['hidden window, gate still up', 'hidden', true, false],
  ])('%s', (_name, visibility, pending, expected) => {
    expect(launchRevealed(host({ visibility, pending }).doc)).toBe(expected)
  })
})

describe('onLaunchRevealed', () => {
  it('starts on the second frame when the document is already on screen', () => {
    const h = host()
    const start = vi.fn()
    onLaunchRevealed(start, { doc: h.doc, win: h.win })

    expect(start).not.toHaveBeenCalled()
    h.frame()
    // One frame paints the reveal; the next is the first an animation can actually occupy.
    expect(start).not.toHaveBeenCalled()
    h.frame()
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('waits out the Deck launch gate instead of starting behind a hidden body', () => {
    const h = host({ pending: true })
    const start = vi.fn()
    onLaunchRevealed(start, { doc: h.doc, win: h.win })

    h.frame()
    h.frame()
    expect(start).not.toHaveBeenCalled()

    h.reveal()
    h.frame()
    h.frame()
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('waits for a hidden window to be shown', () => {
    const h = host({ visibility: 'hidden' })
    const start = vi.fn()
    onLaunchRevealed(start, { doc: h.doc, win: h.win })

    h.frame()
    expect(start).not.toHaveBeenCalled()

    h.show()
    h.frame()
    h.frame()
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('needs both gates open, not either one', () => {
    const h = host({ visibility: 'hidden', pending: true })
    const start = vi.fn()
    onLaunchRevealed(start, { doc: h.doc, win: h.win })

    h.reveal()
    h.frame()
    h.frame()
    expect(start).not.toHaveBeenCalled()

    h.show()
    h.frame()
    h.frame()
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('starts anyway if a gate is never released', () => {
    vi.useFakeTimers()
    const h = host({ pending: true })
    const start = vi.fn()
    onLaunchRevealed(start, { doc: h.doc, win: h.win, timeoutMs: 6000 })

    vi.advanceTimersByTime(5999)
    h.frame()
    h.frame()
    expect(start).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    h.frame()
    h.frame()
    // Never showing the ident at all would be worse than showing it late.
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('runs once however many times the gates flap, and stops listening after', () => {
    const h = host({ visibility: 'hidden', pending: true })
    const start = vi.fn()
    onLaunchRevealed(start, { doc: h.doc, win: h.win })
    expect(h.listenerCount).toBe(1)
    expect(h.observerCount).toBe(1)

    h.show()
    h.reveal()
    h.hold()
    h.reveal()
    h.hide()
    h.show()
    h.frame()
    h.frame()

    expect(start).toHaveBeenCalledTimes(1)
    expect(h.listenerCount).toBe(0)
    expect(h.observerCount).toBe(0)
  })

  it('cancels cleanly when the component unmounts before the reveal', () => {
    const h = host({ pending: true })
    const start = vi.fn()
    const cancel = onLaunchRevealed(start, { doc: h.doc, win: h.win })

    cancel()
    expect(h.listenerCount).toBe(0)
    expect(h.observerCount).toBe(0)

    h.reveal()
    h.show()
    h.frame()
    h.frame()
    expect(start).not.toHaveBeenCalled()
  })

  it('cancelling after the gates opened still prevents a queued start', () => {
    const h = host()
    const start = vi.fn()
    const cancel = onLaunchRevealed(start, { doc: h.doc, win: h.win })

    h.frame()
    cancel()
    h.frame()
    // The second frame is where `start` would have run; a torn-down component must not animate.
    expect(start).not.toHaveBeenCalled()
  })
})
