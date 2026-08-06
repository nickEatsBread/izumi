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
    url.searchParams.set('theme', 'dark')
    return url.toString()
  } catch {
    return embed
  }
}
