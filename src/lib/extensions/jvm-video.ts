export type JvmAudioFlavor = 'sub' | 'dub'
export type JvmSubtitleMode = 'soft' | 'hard'

export interface JvmVideoIdentity {
  server?: string
  quality?: string
  audio?: JvmAudioFlavor
  subtitleMode?: JvmSubtitleMode
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
