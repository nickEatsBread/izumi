import type { Media } from '$lib/anilist/types'
import { banner, cardCover, format, resumeEp, title } from '$lib/anilist/media'
import { mediaRef, type MediaRef } from '$lib/catalog/identity'
import { namedProviderAward } from '$lib/catalog/awards'

export const COMPANION_PROTOCOL = 1 as const
export const COMPANION_CHANNEL = 'com.nicho.izumi.cast'

export interface CompanionPlacement {
  /** Human-readable explanation for why this title is being surfaced. */
  label: string
  position?: number
  kind: 'continue' | 'ranking' | 'recommendation' | 'catalog'
}

export interface CompanionResolverHint {
  /** Stremio resource type; AniList's provider-neutral `anime` type cannot express movies. */
  streamType: 'movie' | 'series'
}

export interface CompanionPlaybackHint {
  /** Manual requests open the linked client's source picker instead of choosing automatically. */
  selection: 'manual'
  /** TV position to retain when the replacement source starts. */
  positionSeconds?: number
}

export type CompanionAchievementKind = 'trending' | 'rating' | 'popularity' | 'award' | 'score'

export interface CompanionAchievement {
  kind: CompanionAchievementKind
  label: string
  source?: string
}

export interface CompanionRating {
  source: string
  score: number
  scale: 5 | 10 | 100
  votes?: number
}

export interface CompanionMedia {
  ref: MediaRef
  /** Non-secret metadata a TV can pass to the owner's Worker when Izumi is unavailable. */
  resolver?: CompanionResolverHint
  /** Transient playback intent. Snapshot/catalog media never needs to persist this field. */
  playback?: CompanionPlaybackHint
  title: string
  subtitle?: string
  description?: string
  /** Provider-supplied age classification shown briefly while TV playback prepares. */
  contentRating?: string
  mediaKind?: 'movie' | 'show'
  genres?: string[]
  releaseYear?: number
  runtimeMinutes?: number
  ratings?: CompanionRating[]
  /** At most two factual, source-attributed reasons this title stands out. */
  achievements?: CompanionAchievement[]
  poster?: string
  backdrop?: string
  /** Transparent provider title treatment/clear-logo preferred by cinematic TV layouts. */
  logoImage?: string
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
  /** Shallow provider-authored recommendations for the TV's post-play experience. */
  recommendations?: CompanionMedia[]
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
  /** The paired client marked this episode as hidden by the user's spoiler preference. */
  spoiler?: boolean
  /** ISO release timestamp when supplied by the active catalogue. */
  releasedAt?: string
}

export type CompanionSkipSegmentType = 'intro' | 'op' | 'mixed-op' | 'recap' | 'outro' | 'ed' | 'mixed-ed' | 'credits' | 'ending'

export interface CompanionSkipSegment {
  type: CompanionSkipSegmentType
  startTime: number
  endTime: number
  label?: string
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
  /** Mirrors the paired client's interface preference for unwatched episode presentation. */
  spoilersHidden?: boolean
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

export type CompanionPlaybackMode = 'device-only' | 'cloud-only' | 'cloud-and-device'

/** Private Web Push route hosted entirely by the user's existing Izumi Worker. */
export interface CompanionCloudflareTransport {
  protocol: 1
  endpoint: string
  pairingId: string
  tvToken: string
  /** Determines whether a TV resolves in the Worker, asks this device, or uses both in order. */
  playbackMode: CompanionPlaybackMode
  /** Android may opt into browser Web Push; desktop always leaves this false. */
  wakeWhenClosed: boolean
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

function resolverHint(media: Pick<Media, 'format' | 'catalog'>): CompanionResolverHint {
  return {
    streamType: media.format === 'MOVIE' || media.catalog?.type === 'movie' ? 'movie' : 'series',
  }
}

function releaseYear(media: Media): number | undefined {
  const value = media.startDate?.year ?? media.seasonYear ?? Number(media.releaseDate?.slice(0, 4))
  return Number.isInteger(value) && value >= 1888 && value <= 2200 ? value : undefined
}

function companionRatings(media: Media): CompanionRating[] | undefined {
  const ratings = (media.ratings ?? [])
    .filter((rating) => Number.isFinite(rating.score) && rating.score >= 0 && rating.score <= rating.scale)
    .slice(0, 4)
    .map(({ source, score, scale, votes }) => ({ source, score, scale, votes }))
  return ratings.length ? ratings : undefined
}

function achievementKind(label: string): CompanionAchievementKind {
  if (/trend/i.test(label)) return 'trending'
  if (/popular/i.test(label)) return 'popularity'
  if (/award|emmy|oscar|bafta|cannes|globe/i.test(label)) return 'award'
  if (/rated|rating/i.test(label)) return 'rating'
  return 'score'
}

function companionAchievements(media: Media, placement?: CompanionPlacement): CompanionAchievement[] | undefined {
  const achievements: CompanionAchievement[] = []
  const push = (achievement: CompanionAchievement) => {
    const duplicate = achievements.some((item) => item.label.toLowerCase() === achievement.label.toLowerCase())
    if (!duplicate && achievements.length < 2) achievements.push(achievement)
  }

  for (const ranking of media.rankings ?? []) {
    if (!Number.isInteger(ranking.rank) || ranking.rank < 1 || !ranking.context?.trim()) continue
    const context = ranking.context.trim()
    const year = !ranking.allTime && ranking.year && !context.includes(String(ranking.year)) ? ` ${ranking.year}` : ''
    push({
      kind: ranking.type === 'POPULAR' ? 'popularity' : 'rating',
      label: `#${ranking.rank} ${context}${year}`,
      source: 'AniList',
    })
  }

  const award = namedProviderAward(media.awards)
  if (award) push({ kind: 'award', label: award, source: media.catalog?.sourceName ?? media.catalog?.provider })

  if (placement?.position && placement.label.trim()) {
    push({
      kind: achievementKind(placement.label),
      label: `#${placement.position} ${placement.label.trim()}`,
      source: media.catalog?.sourceName ?? media.catalog?.provider,
    })
  }

  for (const rating of companionRatings(media) ?? []) {
    const percent = Math.round((rating.score / rating.scale) * 100)
    if (percent < 75) continue
    const isTmdb = rating.source.toLowerCase() === 'tmdb'
    push({
      kind: 'score',
      label: isTmdb ? `${percent}% user score` : `${rating.score}/${rating.scale} rating`,
      source: rating.source,
    })
  }

  if (!media.ratings?.length && (media.averageScore ?? 0) >= 75) {
    push({ kind: 'score', label: `${media.averageScore}% user score`, source: media.catalog?.provider === 'anilist' || !media.catalog ? 'AniList' : media.catalog.sourceName ?? media.catalog.provider })
  }
  return achievements.length ? achievements : undefined
}

function companionFacts(media: Media, resolver: CompanionResolverHint, placement?: CompanionPlacement) {
  const genres = [...new Set((media.genres ?? []).map((genre) => genre.trim()).filter(Boolean))].slice(0, 5)
  return {
    mediaKind: resolver.streamType === 'movie' ? 'movie' as const : 'show' as const,
    genres: genres.length ? genres : undefined,
    releaseYear: releaseYear(media),
    runtimeMinutes: Number.isFinite(media.duration) && (media.duration ?? 0) > 0 ? Math.round(media.duration!) : undefined,
    ratings: companionRatings(media),
    achievements: companionAchievements(media, placement),
  }
}

function companionRelationMedia(media: Media): CompanionMedia {
  const total = Math.max(0, media.episodes ?? 0)
  const resolver = resolverHint(media)
  return {
    ref: mediaRef(media),
    resolver,
    title: title(media),
    subtitle: [media.seasonYear, format(media)].filter(Boolean).join(' · ') || undefined,
    description: stripMarkup(media.description),
    contentRating: media.contentRating || (media.isAdult ? '18' : undefined),
    poster: cardCover(media, 220) || undefined,
    backdrop: banner(media) || undefined,
    logoImage: media.logoImage || undefined,
    trailer: media.trailer?.id ? { id: media.trailer.id, site: media.trailer.site } : undefined,
    ...companionFacts(media, resolver),
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
  const resolver = resolverHint(media)
  const placement = options.placement ?? (media.featuredRank ? {
    label: media.featuredRank.label,
    position: media.featuredRank.position,
    kind: 'ranking' as const,
  } : undefined)
  return {
    ref: mediaRef(media),
    resolver,
    title: title(media),
    subtitle: options.subtitle || format(media) || undefined,
    description: stripMarkup(media.description),
    contentRating: media.contentRating || (media.isAdult ? '18' : undefined),
    poster: cardCover(media, 220) || undefined,
    backdrop: banner(media) || undefined,
    logoImage: media.logoImage || undefined,
    trailer: media.trailer?.id ? { id: media.trailer.id, site: media.trailer.site } : undefined,
    ...companionFacts(media, resolver, placement),
    progress: options.progress ?? (total ? Math.min(1, watched / total) : undefined),
    // A movie is addressed by its title id alone. Supplying the resume helper's synthetic
    // episode 1 makes the linked device reject the resolved movie as the wrong playback target.
    ...(resolver.streamType === 'movie' ? {} : { episode: options.episode ?? resumeEp(media, watched) }),
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
    recommendations: media.recommendations?.nodes
      .flatMap((node) => node.mediaRecommendation ? [companionRelationMedia(node.mediaRecommendation)] : [])
      .slice(0, 12),
    placement,
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
