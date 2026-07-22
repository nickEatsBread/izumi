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
    const url = new URL(embed)
    if (url.hostname === 'disqus.com' && url.pathname.startsWith('/embed/comments')) {
      const out = new URLSearchParams()
      for (const key of ['f', 't_i', 't_u', 't_t']) {
        const value = url.searchParams.get(key)
        if (value != null) out.set(key, value)
      }
      return `/disqus-embed.html?${out.toString()}`
    }
    url.searchParams.set('theme', 'dark')
    return url.toString()
  } catch {
    return embed
  }
}

/** Forum shortname carried by Izumi's local loader or Disqus's original embed URL. */
export function disqusForum(embed: string): string | null {
  try {
    const value = new URL(embed, 'https://izumi.invalid').searchParams.get('f')?.trim() ?? ''
    return /^[a-zA-Z0-9-]+$/.test(value) ? value : null
  } catch {
    return null
  }
}

/** Disqus's documented native-WebView login entry point for a forum embed. */
export function disqusLoginUrl(embed: string): string | null {
  const forum = disqusForum(embed)
  return forum ? `https://disqus.com/next/login/?forum=${encodeURIComponent(forum)}` : null
}

export function reloadedEmbedSrc(embed: string, generation: number): string {
  const url = new URL(embed, 'https://izumi.invalid')
  url.searchParams.set('izumi_login', String(generation))
  return url.origin === 'https://izumi.invalid' ? `${url.pathname}${url.search}` : url.toString()
}
