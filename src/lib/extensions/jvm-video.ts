export type JvmAudioFlavor = 'sub' | 'dub'
export type JvmSubtitleMode = 'soft' | 'hard'

export interface JvmVideoIdentity {
  server?: string
  quality?: string
  audio?: JvmAudioFlavor
  subtitleMode?: JvmSubtitleMode
}

/** Aniyomi's HttpServer is wildcard-bound but advertises localhost. Mark only those local JVM
 * URLs as host-shareable; Izumi's own loopback proxies deliberately remain device-private. */
export function isJvmHostedVideoUrl(value: unknown): boolean {
  try {
    const url = new URL(String(value ?? ''))
    const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && (host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host))
  } catch {
    return false
  }
}

/** The desktop runtime can discover the same factory source through both its generated entry
 * point and its concrete class. Stable source IDs identify those duplicate registrations. */
export function dedupeJvmSources<T extends { id: string }>(sources: T[]): T[] {
  return [...new Map(sources.map((source) => [source.id, source])).values()]
}

/** Some JVM extractors decrypt sidecars into a process-lifetime temporary file. Keep those local
 * file URLs alongside HTTP(S) tracks; the desktop mpv process can read them while the shared JVM
 * runtime remains alive. URL parsing also repairs Java's `file://C:\...` Windows spelling. */
export function normalizeJvmSidecarUrl(value: unknown): string | undefined {
  try {
    const parsed = new URL(String(value ?? ''))
    return ['http:', 'https:', 'file:'].includes(parsed.protocol) ? parsed.href : undefined
  } catch {
    return undefined
  }
}

/**
 * Aniyomi extractors commonly put the information we need in `Video.title`, for example
 * "HD-1 - Sub - 1080p". Others use a leading variant label rather than an explicit server, such
 * as AniDB's "Japanese - 1080p (1920x1080) - 543 KB/s". Preserve that literal label as the
 * per-video server identity: the enclosing JVM result only names the provider, so dropping it
 * makes genuinely different rows render as repeated "AniDB · 1080p" entries.
 */
export function parseJvmVideoTitle(value: unknown): JvmVideoIdentity {
  const title = String(value ?? '').trim()
  if (!title) return {}

  const structured = title.match(/^(.+?)\s+-\s+(Sub|S-Sub|HSub|H-Sub|Dub|A-Dub)\s+-\s+(.+)$/i)
  if (structured) {
    const flavor = structured[2].toLowerCase()
    return {
      server: structured[1].trim(),
      quality: structured[3].trim(),
      audio: flavor.includes('dub') ? 'dub' : 'sub',
      subtitleMode: flavor.startsWith('h') ? 'hard' : 'soft',
    }
  }

  const quality = title.match(/\b\d{3,4}p\b/i)?.[0]
  const leadingLabel = title.split(/\s+-\s+/, 1)[0]?.trim()
  const server = title.includes(' - ')
    && leadingLabel
    && !/^(?:auto|original|source|video|\d{3,4}p)$/i.test(leadingLabel)
    ? leadingLabel
    : undefined
  return { server, quality: quality ?? title }
}
