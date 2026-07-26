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
