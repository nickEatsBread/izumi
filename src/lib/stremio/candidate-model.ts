import { torrentioResolverInfoHash } from './resolver-url'
import type { Stream, StreamEvidence } from './parse'

export type CandidateRouteKind = 'torrent' | 'online' | 'http' | 'youtube' | 'external' | 'unsupported'

export interface CandidateRoute {
  /** Opaque, process-safe identity. Raw URLs (which can contain credentials) never appear here. */
  id: string
  kind: CandidateRouteKind
  stream: Stream
  /** Stable input position, used only to preserve source ordering after grouping. */
  order: number
}

export interface CandidateOffer {
  id: string
  /** Addon fingerprint or extension id where available; never a configured addon URL. */
  sourceId: string
  routes: CandidateRoute[]
}

export interface CandidateRelease {
  id: string
  offers: CandidateOffer[]
}

function digest(text: string): string {
  let a = 0x811c9dc5
  let b = 0x9e3779b9
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    a = Math.imul(a ^ code, 0x01000193)
    b = Math.imul(b ^ code, 0x85ebca6b)
  }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`
}

const clean = (value?: string) => (value ?? '')
  .normalize('NFKC')
  .trim()
  .toLowerCase()
  .replace(/\\/g, '/')
  .replace(/\s+/g, ' ')

const sourceIdentity = (stream: Stream): string => {
  if (stream.__origin?.id) return `${stream.__origin.kind}:${stream.__origin.id}`
  return `anonymous:${clean(stream.__addonName ?? stream.name) || 'unknown'}`
}

function headerIdentity(headers?: Record<string, string>): string {
  return Object.entries(headers ?? {})
    .map(([name, value]) => [name.trim().toLowerCase(), value.trim()] as const)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}:${value}`)
    .join('|')
}

export function candidateRouteKind(stream: Stream): CandidateRouteKind {
  if (stream.__stream) return 'online'
  if (stream.infoHash || torrentioResolverInfoHash(stream.url, stream.__addonName ?? stream.name)) return 'torrent'
  if (stream.url) return 'http'
  if (stream.ytId) return 'youtube'
  if (stream.externalUrl) return 'external'
  return 'unsupported'
}

/** Release identity describes the bytes/content, not who offered it or how it is reached. */
function releaseIdentity(stream: Stream): string {
  const hash = stream.infoHash?.toLowerCase()
    ?? torrentioResolverInfoHash(stream.url, stream.__addonName ?? stream.name)
  if (hash) return `torrent:${hash}`
  const videoHash = clean(stream.behaviorHints?.videoHash)
  if (videoHash) return `video:${videoHash}:${stream.behaviorHints?.videoSize ?? ''}`

  // An online provider's servers/qualities are alternate routes for the same matched episode.
  if (stream.__stream) {
    return `online:${sourceIdentity(stream)}:${stream.__audio ?? ''}:${clean(stream.__sourceTitle ?? stream.behaviorHints?.filename)}`
  }

  const filename = clean(stream.behaviorHints?.filename)
  if (filename) return `file:${filename}:${stream.behaviorHints?.videoSize ?? ''}`
  // Last resort: one opaque release per route. The raw URL exists only during this calculation.
  return `route:${stream.url ?? stream.ytId ?? stream.externalUrl ?? clean(stream.title ?? stream.name)}`
}

/** Route identity is technical: target + file + request headers. It deliberately excludes labels. */
function routeIdentity(stream: Stream): string {
  const kind = candidateRouteKind(stream)
  const hash = stream.infoHash?.toLowerCase()
    ?? torrentioResolverInfoHash(stream.url, stream.__addonName ?? stream.name)
    ?? ''
  const target = kind === 'torrent'
    ? `${hash}|${stream.url ?? ''}|${stream.__magnet ?? ''}|${stream.__torrentUrl ?? ''}|${clean(stream.behaviorHints?.filename)}`
    : stream.url ?? stream.ytId ?? stream.externalUrl ?? ''
  return `${kind}:${target}:file=${stream.fileIdx ?? ''}:headers=${headerIdentity(stream.__headers)}`
}

/** Safe grouping ids for UI keys, recovery and telemetry. */
export function candidateIds(stream: Stream): { releaseId: string; offerId: string; routeId: string } {
  const release = releaseIdentity(stream)
  const offer = `${release}|${sourceIdentity(stream)}`
  const route = `${offer}|${routeIdentity(stream)}`
  return {
    releaseId: `rel-${digest(release)}`,
    offerId: `off-${digest(offer)}`,
    routeId: `rte-${digest(route)}`,
  }
}

const evidenceValue = <K extends keyof StreamEvidence>(
  first: StreamEvidence | undefined,
  second: StreamEvidence | undefined,
  key: K,
): StreamEvidence[K] => first?.[key] ?? second?.[key]

function mergeEvidence(first?: StreamEvidence, second?: StreamEvidence): StreamEvidence | undefined {
  if (!first && !second) return undefined
  const confirmed = first?.confirmedMatch === true || second?.confirmedMatch === true
    ? true
    : evidenceValue(first, second, 'confirmedMatch')
  const best = first?.bestRelease === true || second?.bestRelease === true
    ? true
    : evidenceValue(first, second, 'bestRelease')
  const ranks = [first?.upstreamRank, second?.upstreamRank]
    .filter((rank): rank is number => rank != null && Number.isFinite(rank))
  return {
    confirmedMatch: confirmed,
    bestRelease: best,
    episodeNumber: evidenceValue(first, second, 'episodeNumber'),
    resolution: evidenceValue(first, second, 'resolution'),
    releaseGroup: evidenceValue(first, second, 'releaseGroup'),
    publishedAt: evidenceValue(first, second, 'publishedAt'),
    upstreamRank: ranks.length ? Math.min(...ranks) : undefined,
    requestId: evidenceValue(first, second, 'requestId'),
  }
}

function mergeSubtitles(first: Stream['__subtitles'], second: Stream['__subtitles']): Stream['__subtitles'] {
  const out = [...(first ?? [])]
  const seen = new Set(out.map((subtitle) => `${subtitle.url}|${subtitle.lang ?? ''}|${subtitle.id ?? ''}`))
  for (const subtitle of second ?? []) {
    const key = `${subtitle.url}|${subtitle.lang ?? ''}|${subtitle.id ?? ''}`
    if (!seen.has(key)) { seen.add(key); out.push(subtitle) }
  }
  return out.length ? out : undefined
}

/** Merge only exact duplicate routes from the same offer. Stronger facts survive the collapse. */
function mergeDuplicateRoute(first: Stream, second: Stream): Stream {
  const firstSeeds = first.__seeders ?? -1
  const secondSeeds = second.__seeders ?? -1
  const primary = secondSeeds > firstSeeds ? second : first
  const other = primary === first ? second : first
  return {
    ...primary,
    __seeders: Math.max(firstSeeds, secondSeeds) >= 0 ? Math.max(firstSeeds, secondSeeds) : undefined,
    __accuracy: first.__accuracy === 'high' || second.__accuracy === 'high'
      ? 'high'
      : primary.__accuracy ?? other.__accuracy,
    __evidence: mergeEvidence(primary.__evidence, other.__evidence),
    __subtitles: mergeSubtitles(primary.__subtitles, other.__subtitles),
    __cache: first.__cache === 'cached' || second.__cache === 'cached'
      ? 'cached'
      : primary.__cache ?? other.__cache,
  }
}

/** Build Content's Release → Offer → Route portion without discarding alternate providers/routes. */
export function groupCandidates(streams: Stream[]): CandidateRelease[] {
  type WorkOffer = CandidateOffer & { routeById: Map<string, CandidateRoute> }
  type WorkRelease = CandidateRelease & { offerById: Map<string, WorkOffer> }
  const releases: WorkRelease[] = []
  const releaseById = new Map<string, WorkRelease>()

  streams.forEach((stream, order) => {
    const baseIds = candidateIds(stream)
    // Notice/filter sentinels can reach generic helpers in tests and defensive call sites. With no
    // playable target there is no technical route to dedupe, so preserve each row independently.
    const ids = candidateRouteKind(stream) === 'unsupported'
      ? { ...baseIds, routeId: `${baseIds.routeId}-${order}` }
      : baseIds
    let release = releaseById.get(ids.releaseId)
    if (!release) {
      release = { id: ids.releaseId, offers: [], offerById: new Map() }
      releaseById.set(ids.releaseId, release)
      releases.push(release)
    }
    let offer = release.offerById.get(ids.offerId)
    if (!offer) {
      offer = { id: ids.offerId, sourceId: stream.__origin?.id ?? '', routes: [], routeById: new Map() }
      release.offerById.set(ids.offerId, offer)
      release.offers.push(offer)
    }
    const existing = offer.routeById.get(ids.routeId)
    if (existing) {
      existing.stream = mergeDuplicateRoute(existing.stream, stream)
      return
    }
    const route = { id: ids.routeId, kind: candidateRouteKind(stream), stream, order }
    offer.routeById.set(ids.routeId, route)
    offer.routes.push(route)
  })

  return releases.map(({ id, offers }) => ({
    id,
    offers: offers.map(({ id: offerId, sourceId, routes }) => ({ id: offerId, sourceId, routes })),
  }))
}

/** Compatibility bridge for the existing flat picker. Every distinct route survives and carries
 *  enough grouping metadata for the planner/UI to reason at the release level. */
export function flattenCandidateGroups(groups: CandidateRelease[]): Stream[] {
  const flattened: Array<{ order: number; stream: Stream }> = []
  for (const release of groups) {
    const routeCount = release.offers.reduce((count, offer) => count + offer.routes.length, 0)
    for (const offer of release.offers) {
      for (const route of offer.routes) {
        flattened.push({
          order: route.order,
          stream: {
            ...route.stream,
            __candidate: {
              releaseId: release.id,
              offerId: offer.id,
              routeId: route.id,
              offerCount: release.offers.length,
              routeCount,
            },
          },
        })
      }
    }
  }
  return flattened.sort((a, b) => a.order - b.order).map(({ stream }) => stream)
}

export function normalizeCandidates(streams: Stream[]): Stream[] {
  return flattenCandidateGroups(groupCandidates(streams))
}
