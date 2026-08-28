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
}

/**
 * A validated touch-scroll relay from the same-origin Disqus loader. Android expands that loader to
 * its content height, so its cross-origin child cannot scroll itself or naturally chain the gesture
 * into the surrounding watch-page scroller.
 */
export function embedTouchScroll(origin: string, data: unknown, appOrigin: string): EmbedTouchScroll | null {
  const message = data as { type?: unknown; phase?: unknown; dy?: unknown; dt?: unknown } | null
  if (origin !== appOrigin || message?.type !== 'izumi-disqus-page-scroll') return null
  if (message.phase !== 'start' && message.phase !== 'move' && message.phase !== 'end') return null
  if (message.phase !== 'move') return { phase: message.phase, dy: 0, dt: 0 }
  const dy = Number(message.dy)
  const dt = Number(message.dt)
  if (!Number.isFinite(dy) || Math.abs(dy) > 300 || !Number.isFinite(dt) || dt <= 0) return null
  return { phase: 'move', dy, dt: Math.min(100, dt) }
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
