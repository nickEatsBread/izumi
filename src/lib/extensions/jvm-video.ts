export type JvmAudioFlavor = 'sub' | 'dub'
export type JvmSubtitleMode = 'soft' | 'hard'

export interface JvmVideoIdentity {
  server?: string
  quality?: string
  audio?: JvmAudioFlavor
  subtitleMode?: JvmSubtitleMode
}

/**
 * Aniyomi extractors commonly put the information we need in `Video.title`, for example
 * "HD-1 - Sub - 1080p". Keep the parser deliberately conservative so an unrelated title remains
 * a quality label instead of being split into invented metadata.
 */
export function parseJvmVideoTitle(value: unknown): JvmVideoIdentity {
  const title = String(value ?? '').trim()
  const match = title.match(/^(.+?)\s+-\s+(Sub|HSub|Dub)\s+-\s+(.+)$/i)
  if (!match) return { quality: title || undefined }
  const flavor = match[2].toLowerCase()
  return {
    server: match[1].trim(),
    quality: match[3].trim(),
    audio: flavor === 'dub' ? 'dub' : 'sub',
    subtitleMode: flavor === 'hsub' ? 'hard' : 'soft',
  }
}

function nestedLoopbackUrl(value: string): URL | undefined {
  try {
    const outer = new URL(value)
    if (!['localhost', '127.0.0.1', '[::1]'].includes(outer.hostname)) return undefined
    const nested = outer.searchParams.get('url')
    return nested ? new URL(nested) : undefined
  } catch {
    return undefined
  }
}

/**
 * Anikoto's VidPlay transport disguises MPEG-TS segments as images and decodes them in a JVM
 * localhost server. Its current junk-block detector removes valid H.264 payload bytes: the output
 * contains corrupt TS packets, visible macroblocks, skipped frames, and nonsensical duration in
 * libmpv. Other Aniyomi localhost helpers are left alone; this targets only the proven-bad
 * VidPlay + kotocdn combination while the provider's healthy HD/Vidstream alternatives remain.
 */
export function isKnownBrokenJvmVideo(url: string, server?: string): boolean {
  if (!/^VidPlay(?:-\d+)?$/i.test(server ?? '')) return false
  const upstream = nestedLoopbackUrl(url)
  return !!upstream && /(?:^|\.)kotocdn\.site$/i.test(upstream.hostname)
}
