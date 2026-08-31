import type { CastLoadRequest, CastSubtitleTrack, CompanionMedia, PlaybackSourceChoice } from '../types'

export interface CloudResolveRequest {
  ref: CompanionMedia['ref']
  episode?: number
  season?: number
  streamType: 'movie' | 'series'
}

interface DirectSourceCandidate {
  id: string
  url: string
  title?: string
  quality?: string
  badges: string[]
  source?: string
  contentType?: string
  subtitles: CastSubtitleTrack[]
  cookies?: string
  userAgent?: string
}

function publicHttpUrl(value: unknown, maximum = 4096): string | undefined {
  if (typeof value !== 'string' || !value || value.length > maximum) return undefined
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    const octets = host.split('.').map(Number)
    const privateIpv4 = octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) && (
      octets[0] === 0
      || octets[0] === 10
      || octets[0] === 127
      || octets[0] >= 224
      || octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127
      || octets[0] === 169 && octets[1] === 254
      || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31
      || octets[0] === 192 && octets[1] === 168
    )
    if ((url.protocol !== 'https:' && url.protocol !== 'http:')
      || !host
      || host === 'localhost'
      || host.endsWith('.localhost')
      || host.endsWith('.local')
      || host.endsWith('.internal')
      || host.includes(':')
      || privateIpv4) return undefined
    return url.toString()
  } catch { return undefined }
}

function boundedText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string' || !value || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) return undefined
  return value
}

function headerValue(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string' || !value || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) return undefined
  return value
}

function subtitleContentType(url: string): string | undefined {
  if (/\.vtt(?:[?#]|$)/i.test(url)) return 'text/vtt'
  if (/\.srt(?:[?#]|$)/i.test(url)) return 'application/x-subrip'
  if (/\.ass(?:[?#]|$)/i.test(url)) return 'text/x-ass'
  if (/\.ssa(?:[?#]|$)/i.test(url)) return 'text/x-ssa'
  return undefined
}

function normalizeCandidate(value: unknown): DirectSourceCandidate | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  const id = boundedText(input.id, 160)
  const url = publicHttpUrl(input.url, 8192)
  if (!id || !url) return null
  const subtitles = (Array.isArray(input.subtitles) ? input.subtitles : []).slice(0, 8).flatMap((value, index) => {
    if (!value || typeof value !== 'object') return []
    const track = value as Record<string, unknown>
    const trackUrl = publicHttpUrl(track.url, 8192)
    if (!trackUrl) return []
    return [{
      id: index + 1,
      url: trackUrl,
      title: boundedText(track.title, 160),
      lang: boundedText(track.lang, 24),
      contentType: boundedText(track.contentType, 80) ?? subtitleContentType(trackUrl),
    }]
  })
  return {
    id,
    url,
    title: boundedText(input.title, 240),
    quality: boundedText(input.quality, 40),
    badges: (Array.isArray(input.badges) ? input.badges : [])
      .slice(0, 6)
      .flatMap((badge) => boundedText(badge, 80) ?? []),
    source: boundedText(input.source, 120),
    contentType: boundedText(input.contentType, 120),
    subtitles,
    cookies: headerValue(input.cookies, 4096),
    userAgent: headerValue(input.userAgent, 512),
  }
}

export interface CloudResolveSelection {
  selectedId: string
  request: CastLoadRequest
  sources: PlaybackSourceChoice[]
}

function resumePosition(media: CompanionMedia): number {
  const progress = Number(media.episodeProgress)
  const runtime = Number(media.episodeRuntimeMinutes)
  if (!Number.isFinite(progress) || !Number.isFinite(runtime) || progress <= 0 || runtime <= 0) return 0
  return Math.min(604_800, Math.min(1, Math.max(0, progress)) * Math.min(10_080, runtime) * 60)
}

export function cloudResolveRequest(media: CompanionMedia): CloudResolveRequest {
  return {
    ref: media.ref,
    episode: Number.isInteger(media.episode) && Number(media.episode) > 0 ? media.episode : undefined,
    season: Number.isInteger(media.season) && Number(media.season) >= 0 ? media.season : undefined,
    streamType: media.resolver?.streamType === 'movie' || media.resolver?.streamType === 'series'
      ? media.resolver.streamType
      : media.ref.type === 'movie' ? 'movie' : 'series',
  }
}

function sourceLabel(candidate: DirectSourceCandidate, index: number): { label: string; detail?: string } {
  const label = candidate.title ?? candidate.quality ?? candidate.source ?? `Source ${index + 1}`
  const details = [candidate.quality, candidate.source, ...candidate.badges]
    .filter((part): part is string => Boolean(part) && part !== label)
    .filter((part, partIndex, all) => all.indexOf(part) === partIndex)
  return { label, detail: details.length ? details.join(' · ').slice(0, 240) : undefined }
}

/** Preserve the Worker's ranked candidates so the TV can switch sources without resolving again. */
export function cloudResolveSelection(value: unknown, media: CompanionMedia, requestId: string): CloudResolveSelection | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  if (input.ok !== true || !Array.isArray(input.candidates)) return null
  const candidates = input.candidates.slice(0, 8).flatMap((candidate) => {
    const normalized = normalizeCandidate(candidate)
    return normalized ? [normalized] : []
  })
  const selectedId = boundedText(input.selectedId, 160)
  const selected = candidates.find((candidate) => candidate.id === selectedId) ?? candidates[0]
  if (!selected) return null
  const selectedCandidateId = selected.id
  const sources = candidates.map((candidate, index): PlaybackSourceChoice => ({
    id: candidate.id,
    ...sourceLabel(candidate, index),
    request: {
      sessionId: `cloud-${requestId.slice(0, 80)}-${index + 1}`,
      url: candidate.url,
      title: boundedText(media.title, 240) ?? 'Izumi',
      contentRating: boundedText(media.contentRating, 32),
      contentType: candidate.contentType,
      positionSeconds: resumePosition(media),
      subtitles: candidate.subtitles,
      activeTrackIds: [],
      cookies: candidate.cookies,
      userAgent: candidate.userAgent,
    },
  }))
  return {
    selectedId: selectedCandidateId,
    request: sources.find((source) => source.id === selectedCandidateId)!.request,
    sources,
  }
}

/** Convert a private Worker response into the same load contract used by a paired Izumi client. */
export function cloudResolveLoad(value: unknown, media: CompanionMedia, requestId: string): CastLoadRequest | null {
  return cloudResolveSelection(value, media, requestId)?.request ?? null
}
