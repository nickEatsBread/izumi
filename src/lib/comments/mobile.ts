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
