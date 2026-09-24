import type { DiscussionThread } from './types'

export type MobileDiscussion =
  | { kind: 'disqus'; thread: DiscussionThread; embedSrc: string }
  | { kind: 'reddit'; thread: DiscussionThread }

/** Android's inline watch page deliberately keeps the source policy small and predictable. */
export function preferredMobileDiscussion(threads: DiscussionThread[]): MobileDiscussion | null {
  const disqus = threads.find((thread) => thread.source === 'Disqus' && !!thread.embedUrl)
  if (disqus?.embedUrl) return { kind: 'disqus', thread: disqus, embedSrc: mobileEmbedSrc(disqus.embedUrl) }

  const reddit = threads.find((thread) =>
    thread.source === 'Reddit' && ((thread.comments?.length ?? 0) > 0 || !!thread.body?.trim()),
  )
  return reddit ? { kind: 'reddit', thread: reddit } : null
}

/**
 * First-party discussion page suitable for a real browser. Google deliberately refuses OAuth in
 * embedded WebViews, so Android offers this URL as the secure sign-in/commenting fallback.
 */
export function discussionBrowserUrl(thread: DiscussionThread): string | null {
  const candidates = [thread.url]
  if (thread.embedUrl) {
    try { candidates.push(new URL(thread.embedUrl).searchParams.get('t_u') ?? undefined) }
    catch { /* A malformed embed URL simply has no browser fallback. */ }
  }
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      const url = new URL(candidate)
      if (url.protocol === 'https:') return url.toString()
    } catch { /* Try the next candidate. */ }
  }
  return null
}

/** Origin of the cross-origin discussanime archive embed (the mapper's `forum` threads). */
export const ARCHIVE_EMBED_ORIGIN = 'https://discussanime.moe'

/**
 * Content height (CSS px) an embed frame is reporting, or null when the message is not a height
 * report. Two senders exist: the same-origin Disqus loader page posts `izumi-disqus-height`, and
 * the cross-origin archive — which hides its own overflow, so the iframe MUST be sized to content
 * or it clips unscrollably — posts `discussanime-archive-embed:resize` from its own origin.
 * Callers still gate on `event.source` being the embed iframe.
 */
export function embedResizeHeight(origin: string, data: unknown, appOrigin: string): number | null {
  const message = data as { type?: unknown; height?: unknown } | null
  const heightReport =
    (message?.type === 'izumi-disqus-height' && origin === appOrigin) ||
    (message?.type === 'discussanime-archive-embed:resize' && origin === ARCHIVE_EMBED_ORIGIN)
  if (!heightReport) return null
  const height = Number(message?.height)
  if (!Number.isFinite(height) || height <= 0) return null
  return Math.max(480, Math.min(100_000, Math.ceil(height)))
}

export type EmbedTouchScroll = {
  phase: 'start' | 'move' | 'end'
  dy: number
  dt: number
  /** False once the browser is scrolling natively somewhere in the frame chain (Chromium marks
   *  the touchmoves of an active scroll uncancelable). The page must then leave the gesture alone. */
  cancelable: boolean
}

/**
 * A validated drag relayed by the same-origin Disqus loader. The Android page expands Disqus to
 * its full content height, so the cross-origin child has no scrollbar; the browser normally
 * chains the drag to the surrounding watch-page scroller by itself, and the relay exists so the
 * page can take the gesture over when that chaining does not happen.
 */
export function embedTouchScroll(origin: string, data: unknown, appOrigin: string): EmbedTouchScroll | null {
  const message = data as { type?: unknown; phase?: unknown; dy?: unknown; dt?: unknown; cancelable?: unknown } | null
  if (origin !== appOrigin || message?.type !== 'izumi-disqus-page-scroll') return null
  if (message.phase !== 'start' && message.phase !== 'move' && message.phase !== 'end') return null
  if (message.phase !== 'move') return { phase: message.phase, dy: 0, dt: 0, cancelable: true }
  const dy = Number(message.dy)
  const dt = Number(message.dt)
  if (!Number.isFinite(dy) || Math.abs(dy) > 300 || !Number.isFinite(dt) || dt <= 0) return null
  return { phase: 'move', dy, dt: Math.min(100, dt), cancelable: message.cancelable !== false }
}

export type EmbedGestureOwner = 'undecided' | 'native' | 'page'

/** Minimum finger travel before the page may conclude that nobody else is scrolling it. Chromium
 *  starts a native scroll at its own ~8dp slop, so anything shorter proves nothing either way. */
export const EMBED_GESTURE_SLOP_PX = 12

/**
 * Who owns a drag that started inside the expanded comments frame, decided one move at a time.
 * Native scrolling announces itself twice over — the moves turn uncancelable and the scroller's
 * offset changes under us — and either sign settles it for the rest of the gesture. Only when the
 * finger has travelled past the slop on a second cancelable move, with the scroller not having
 * moved although it had room to, does the page take the drag over. A single fast move past the
 * slop is not enough: it is the very move that starts a native scroll, and reads cancelable.
 */
export function decideEmbedGestureOwner(state: {
  owner: EmbedGestureOwner
  pending: number
  armed: boolean
}, move: { dy: number; cancelable: boolean }, scroller: {
  scrollTop: number
  startTop: number
  scrollHeight: number
  clientHeight: number
}): { owner: EmbedGestureOwner; pending: number; armed: boolean } {
  if (state.owner !== 'undecided') return state
  if (!move.cancelable || scroller.scrollTop !== scroller.startTop) return { owner: 'native', pending: 0, armed: false }
  const pending = state.pending + move.dy
  if (Math.abs(pending) < EMBED_GESTURE_SLOP_PX) return { owner: 'undecided', pending, armed: false }
  if (!state.armed) return { owner: 'undecided', pending, armed: true }
  const room = pending > 0
    ? scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop
    : scroller.scrollTop
  // At an edge nothing could have moved, so nothing has been learned; leave it to the browser.
  if (room <= 0) return { owner: 'native', pending: 0, armed: false }
  return { owner: 'page', pending, armed: true }
}

/** A bare disqus.com inner iframe needs Izumi's same-origin embed.js loader to render. */
export function mobileEmbedSrc(embed: string): string {
  try {
    const url = new URL(embed, globalThis.location?.origin ?? 'https://izumi.invalid')
    if (url.pathname === '/disqus-embed.html') {
      url.searchParams.set('izumi_expand', '1')
      return `${url.pathname}?${url.searchParams.toString()}`
    }
    if (url.hostname === 'disqus.com' && url.pathname.startsWith('/embed/comments')) {
      const out = new URLSearchParams()
      for (const key of ['f', 't_i', 't_u', 't_t']) {
        const value = url.searchParams.get(key)
        if (value != null) out.set(key, value)
      }
      out.set('izumi_expand', '1')
      return `/disqus-embed.html?${out.toString()}`
    }
    return url.toString()
  } catch {
    return embed
  }
}
