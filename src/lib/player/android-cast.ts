export interface CastSource {
  url?: string | null
  headers?: Record<string, string> | null
  infoHash?: string | null
  filename?: string | null
  manifest?: 'hls' | 'dash' | null
  drm?: unknown
  /** Language reported by a direct-stream provider before mpv exposes its live tracks. */
  audioLang?: string
  /** Alternate provider manifests. A switchUrl is already muxed for that audio language and can
   * be opened by a TV; a bare url is an mpv-only external audio sidecar. */
  audioTracks?: { lang?: string; title?: string; switchUrl?: string }[]
}

export interface CastTrack {
  type: 'video' | 'audio' | 'sub'
  selected?: boolean
  codec?: string
  codecProfile?: string
  format?: string
  title?: string
  lang?: string
  externalFilename?: string
}

export interface CastTrackPreference {
  language?: string
  title?: string
  codec?: string
}

export interface CastTrackPreferences {
  audio?: CastTrackPreference
  subtitle?: CastTrackPreference
}

const languageKey = (value: string | undefined) => {
  const key = value?.trim().toLowerCase().replace('_', '-').split('-')[0] ?? ''
  return ({ eng: 'en', jpn: 'ja', spa: 'es', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', ita: 'it', por: 'pt' } as Record<string, string>)[key] ?? key
}

function trackPreference(track: CastTrack | undefined, fallbackLanguage?: string): CastTrackPreference | undefined {
  const language = track?.lang?.trim() || fallbackLanguage?.trim()
  const title = track?.title?.trim()
  const codec = track?.codec?.trim()
  return language || title || codec ? { language, title, codec } : undefined
}

/** Carry the sender's actual mpv selections to a receiver whose track indexes will be different. */
export function castTrackPreferences(source: CastSource, tracks: CastTrack[]): CastTrackPreferences | undefined {
  const audio = trackPreference(tracks.find((track) => track.type === 'audio' && track.selected), source.audioLang)
  const subtitle = trackPreference(tracks.find((track) => track.type === 'sub' && track.selected))
  return audio || subtitle ? { audio, subtitle } : undefined
}

/** Provider audio variants represented by switchUrl are complete manifests, unlike mpv audio-add
 * sidecars. Select the manifest matching the live audio track before handing the source to a TV. */
export function tvCastSource(source: CastSource, tracks: CastTrack[]): CastSource {
  const selectedLanguage = tracks.find((track) => track.type === 'audio' && track.selected)?.lang || source.audioLang
  const switchable = (source.audioTracks ?? []).filter((track) => track.switchUrl)
  const selected = switchable.find((track) => languageKey(track.lang) === languageKey(selectedLanguage))
    ?? (switchable.length === 1 ? switchable[0] : undefined)
  return selected?.switchUrl ? { ...source, url: selected.switchUrl, audioLang: selected.lang || selectedLanguage } : source
}

export type CastSourceDecision =
  | { ok: true; url: string; contentType: string; warnings: string[] }
  | { ok: false; error: string }

const extensionOf = (source: CastSource, url: URL) => {
  const extension = (value: string | null | undefined) =>
    value?.trim().match(/\.([a-z0-9]+)(?:$|[?#])/i)?.[1]?.toLowerCase() ?? ''
  // A display label such as "Direct MP4 · Vidstream" is not a filename. It must not hide the
  // real extension on the resolved URL, otherwise an automatically-selected JVM source reaches
  // the TV handoff with no identifiable container.
  return extension(source.filename) || extension(url.pathname)
}

function contentTypeFor(source: CastSource, url: URL, fileFormat?: string | null): string | null {
  if (source.manifest === 'hls') return 'application/vnd.apple.mpegurl'
  if (source.manifest === 'dash') return 'application/dash+xml'

  const extension = extensionOf(source, url)
  if (extension === 'm3u8') return 'application/vnd.apple.mpegurl'
  if (extension === 'mpd') return 'application/dash+xml'
  if (['mp4', 'm4v'].includes(extension)) return 'video/mp4'
  if (extension === 'mkv') return 'video/x-matroska'
  if (extension === 'avi') return 'video/x-msvideo'
  if (extension === 'webm') return 'video/webm'
  if (['ts', 'm2ts'].includes(extension)) return 'video/mp2t'
  if (extension === 'mp3') return 'audio/mpeg'
  if (['m4a', 'aac'].includes(extension)) return 'audio/mp4'
  if (['ogg', 'oga'].includes(extension)) return 'audio/ogg'
  if (extension === 'wav') return 'audio/wav'
  if (extension === 'flac') return 'audio/flac'

  const format = fileFormat?.toLowerCase() ?? ''
  if (format.includes('hls')) return 'application/vnd.apple.mpegurl'
  if (format.includes('dash')) return 'application/dash+xml'
  if (/\b(?:mov|mp4|m4a|3gp|3g2|mj2)\b/.test(format)) return 'video/mp4'
  if (format.includes('matroska')) return 'video/x-matroska'
  if (/\bavi\b/.test(format)) return 'video/x-msvideo'
  if (format.includes('webm')) return 'video/webm'
  if (format.includes('mpegts')) return 'video/mp2t'
  if (format === 'mp3') return 'audio/mpeg'
  if (format === 'flac') return 'audio/flac'
  return null
}

function normalizedCodec(value: string | undefined) {
  return value?.trim().toLowerCase().replaceAll('-', '').replaceAll('_', '') ?? ''
}

/**
 * Decide whether Google's Default Media Receiver can direct-play the source. This is deliberately
 * conservative: unsupported media stays in libmpv instead of silently starting a conversion job.
 */
export function castSourceDecision(
  source: CastSource | null | undefined,
  tracks: CastTrack[] = [],
  fileFormat?: string | null,
  target: 'googleCast' | 'tv' = 'googleCast',
): CastSourceDecision {
  const rawUrl = source?.url?.trim()
  if (!rawUrl) return { ok: false, error: 'Cast needs a playable stream.' }
  if (source?.drm && target !== 'tv') return { ok: false, error: 'This protected stream needs a dedicated Cast receiver.' }

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { ok: false, error: 'Cast cannot open a local file path.' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'Cast needs an HTTP or HTTPS stream.' }
  }
  const activeSource = source as CastSource

  const extension = extensionOf(activeSource, url)
  if (target === 'googleCast'
    && (['mkv', 'avi', 'wmv', 'flv'].includes(extension) || /matroska|avi|asf/.test(fileFormat?.toLowerCase() ?? ''))) {
    return { ok: false, error: `Cast cannot direct-play ${extension ? `.${extension}` : 'this container'}; keep playing it in libmpv.` }
  }

  const contentType = contentTypeFor(activeSource, url, fileFormat)
  if (!contentType) {
    return { ok: false, error: 'Cast could not identify a supported stream container.' }
  }
  if (contentType === 'application/dash+xml'
    && (Object.keys(activeSource.headers ?? {}).length > 0 || ['localhost', '127.0.0.1', '::1'].includes(url.hostname))) {
    return { ok: false, error: 'Header-bound or local DASH needs a dedicated Cast receiver.' }
  }

  const selected = tracks.filter((track) => track.selected !== false)
  const video = selected.find((track) => track.type === 'video')
  const audio = selected.find((track) => track.type === 'audio')
  const subtitle = selected.find((track) => track.type === 'sub')
  const videoCodec = normalizedCodec(video?.codec)
  const audioCodec = normalizedCodec(audio?.codec)
  const profile = video?.codecProfile?.toLowerCase() ?? ''

  if (target === 'googleCast' && /high\s*10|high10|10-bit h\.264/.test(profile) && ['h264', 'avc1'].includes(videoCodec)) {
    return { ok: false, error: 'Cast cannot direct-play 10-bit H.264; keep playing it in libmpv.' }
  }
  if (target === 'googleCast' && contentType === 'video/mp2t' && ['hevc', 'h265'].includes(videoCodec)) {
    return { ok: false, error: 'Cast does not support HEVC inside an MPEG-TS stream.' }
  }
  if (target === 'googleCast' && ['dts', 'dtshd', 'truehd'].includes(audioCodec)) {
    return { ok: false, error: `Cast cannot direct-play ${audio?.codec ?? 'this audio codec'}.` }
  }

  const warnings: string[] = []
  const subtitleCodec = normalizedCodec(subtitle?.codec)
  const subtitleName = subtitle?.externalFilename?.toLowerCase() ?? ''
  if (target === 'googleCast' && subtitle && (['ass', 'ssa', 'substationalpha', 'asssubtitle'].includes(subtitleCodec)
    || /\.(?:ass|ssa)(?:$|[?#])/.test(subtitleName))) {
    warnings.push('Selected ASS subtitles cannot be sent to the Default Media Receiver.')
  }

  return { ok: true, url: rawUrl, contentType, warnings }
}

export function castSubtitleFormat(url: string): 'vtt' | 'srt' | 'ttml' | 'ass' | null {
  let pathname: string
  try { pathname = new URL(url).pathname.toLowerCase() } catch { return null }
  if (pathname.endsWith('.vtt')) return 'vtt'
  if (pathname.endsWith('.srt')) return 'srt'
  if (pathname.endsWith('.ass') || pathname.endsWith('.ssa')) return 'ass'
  if (pathname.endsWith('.ttml') || pathname.endsWith('.xml')) return 'ttml'
  return null
}
