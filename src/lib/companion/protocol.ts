import type { Media } from '$lib/anilist/types'
import { banner, cardCover, format, resumeEp, title } from '$lib/anilist/media'
import { mediaRef, type MediaRef } from '$lib/catalog/identity'

export const COMPANION_PROTOCOL = 1 as const
export const COMPANION_CHANNEL = 'com.nicho.izumi.cast'

export interface CompanionPlacement {
  /** Human-readable explanation for why this title is being surfaced. */
  label: string
  position?: number
  kind: 'continue' | 'ranking' | 'recommendation' | 'catalog'
}

export interface CompanionMedia {
  ref: MediaRef
  title: string
  subtitle?: string
  description?: string
  /** Provider-supplied age classification shown briefly while TV playback prepares. */
  contentRating?: string
  poster?: string
  backdrop?: string
  /** Provider trailer used by the TV series page. */
  trailer?: { id: string; site?: string }
  /** Normalized 0–1 progress for a TV card. */
  progress?: number
  /** Resume episode requested when this card is activated. */
  episode?: number
  /** Episode-level presentation data used by landscape Continue Watching cards. */
  episodeTitle?: string
  episodeImage?: string
  season?: number
  /** Normalized 0–1 playback position within the resume episode. */
  episodeProgress?: number
  episodeRuntimeMinutes?: number
  /** True only when this title belongs to the signed-in user's media list. */
  inMyList?: boolean
  /** Episode counts for each season represented by this catalog title. */
  seasonEpisodeCounts?: number[]
  /** Optional human-readable labels for the corresponding season entries. */
  seasonLabels?: string[]
  /** Optional episode metadata supplied by Stremio or another paired catalogue. */
  episodes?: CompanionEpisode[]
  /** Shallow provider relations for franchise navigation on a TV. */
  relations?: CompanionRelation[]
  placement?: CompanionPlacement
}

export interface CompanionEpisode {
  season: number
  episode: number
  title?: string
  description?: string
  image?: string
  runtimeMinutes?: number
  progress?: number
  watched?: boolean
}

export interface CompanionRelation {
  relationType: string
  media: CompanionMedia
}

export interface CompanionHomeRow {
  id: string
  title: string
  kind: 'continue' | 'catalog'
  presentation?: 'standard' | 'top-10'
  items: CompanionMedia[]
}

export interface CompanionCatalogOption {
  screen: string
  label: string
}

/** Provider-neutral payload consumed by the standalone TV project. */
export interface CompanionHomeSnapshot {
  app: 'izumi'
  kind: 'companion-home'
  version: typeof COMPANION_PROTOCOL
  revision: string
  generatedAt: number
  catalog: { screen: string; label: string; options?: CompanionCatalogOption[] }
  hero?: CompanionMedia
  rows: CompanionHomeRow[]
  views?: {
    search?: CompanionMedia[]
    trending?: CompanionMedia[]
    series?: CompanionMedia[]
    movies?: CompanionMedia[]
    myList?: CompanionMedia[]
  }
}

export interface CompanionPairingLink {
  protocol: typeof COMPANION_PROTOCOL
  address: string
  deviceId: string
  challenge: string
}

export interface CompanionTransportEndpoint {
  url: string
  token: string
}

export interface CompanionCloudflareInvite {
  /** Existing encrypted sync invite; the TV claims its own device credential from it. */
  ticket: string
}

/** Private Web Push route hosted entirely by the user's existing Izumi Worker. */
export interface CompanionCloudflareTransport {
  protocol: 1
  endpoint: string
  pairingId: string
  tvToken: string
}

export interface CompanionPairRequest {
  protocol: typeof COMPANION_PROTOCOL
  challenge: string
  credential: string
  groupName: string
  transport: {
    bridge?: CompanionTransportEndpoint
    cloudflare?: CompanionCloudflareInvite | CompanionCloudflareTransport
  }
  snapshot: CompanionHomeSnapshot
}

const PRIVATE_V4 = /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/

export function parseCompanionPairingLink(raw: string): CompanionPairingLink | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'izumi:' || url.hostname !== 'companion' || url.pathname !== '/pair') return null
    const address = url.searchParams.get('tv')?.trim() ?? ''
    const deviceId = url.searchParams.get('device')?.trim() ?? ''
    const challenge = url.searchParams.get('challenge')?.trim() ?? ''
    if (url.searchParams.get('v') !== '1' || !PRIVATE_V4.test(address)) return null
    if (!/^[0-9a-f]{24}$/i.test(deviceId) || !/^[0-9a-f]{32}$/i.test(challenge)) return null
    return { protocol: COMPANION_PROTOCOL, address, deviceId, challenge }
  } catch {
    return null
  }
}

function stripMarkup(value: string | undefined): string | undefined {
  const text = value?.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, 900) : undefined
}

function companionRelationMedia(media: Media): CompanionMedia {
  const total = Math.max(0, media.episodes ?? 0)
  return {
    ref: mediaRef(media),
    title: title(media),
    subtitle: [media.seasonYear, format(media)].filter(Boolean).join(' · ') || undefined,
    description: stripMarkup(media.description),
    contentRating: media.contentRating || (media.isAdult ? '18' : undefined),
    poster: cardCover(media, 220) || undefined,
    backdrop: banner(media) || undefined,
    trailer: media.trailer?.id ? { id: media.trailer.id, site: media.trailer.site } : undefined,
    seasonEpisodeCounts: total ? [total] : undefined,
  }
}

export function companionMedia(
  media: Media,
  options: {
    watched?: number
    progress?: number
    episode?: number
    episodeTitle?: string
    episodeImage?: string
    season?: number
    episodeProgress?: number
    episodeRuntimeMinutes?: number
    episodes?: CompanionEpisode[]
    subtitle?: string
    placement?: CompanionPlacement
  } = {},
): CompanionMedia {
  const watched = Math.max(0, options.watched ?? media.mediaListEntry?.progress ?? 0)
  const total = Math.max(0, media.episodes ?? 0)
  return {
    ref: mediaRef(media),
    title: title(media),
    subtitle: options.subtitle || format(media) || undefined,
    description: stripMarkup(media.description),
    contentRating: media.contentRating || (media.isAdult ? '18' : undefined),
    poster: cardCover(media, 220) || undefined,
    backdrop: banner(media) || undefined,
    trailer: media.trailer?.id ? { id: media.trailer.id, site: media.trailer.site } : undefined,
    progress: options.progress ?? (total ? Math.min(1, watched / total) : undefined),
    episode: options.episode ?? resumeEp(media, watched),
    episodeTitle: options.episodeTitle,
    episodeImage: options.episodeImage,
    season: options.season,
    episodeProgress: options.episodeProgress,
    episodeRuntimeMinutes: options.episodeRuntimeMinutes,
    inMyList: Boolean(media.mediaListEntry),
    episodes: options.episodes,
    seasonEpisodeCounts: total ? [total] : undefined,
    relations: media.relations?.edges
      .filter((edge) => edge.relationType !== 'ADAPTATION' && edge.node.type !== 'MANGA')
      .slice(0, 12)
      .map((edge) => ({ relationType: edge.relationType, media: companionRelationMedia(edge.node) })),
    placement: options.placement ?? (media.featuredRank ? {
      label: media.featuredRank.label,
      position: media.featuredRank.position,
      kind: 'ranking',
    } : undefined),
  }
}

export function isCompanionSnapshot(value: unknown): value is CompanionHomeSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Partial<CompanionHomeSnapshot>
  return snapshot.app === 'izumi'
    && snapshot.kind === 'companion-home'
    && snapshot.version === COMPANION_PROTOCOL
    && typeof snapshot.revision === 'string'
    && typeof snapshot.generatedAt === 'number'
    && Array.isArray(snapshot.rows)
}
