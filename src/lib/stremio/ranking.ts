import { describe, isWrongSeason, type CacheState, type Stream, type StreamInfo, type StreamSort } from './parse'
import { torrentioResolverInfoHash } from './resolver-url'
import { scoreInfo, subtitleCompatibility, swarmSupplies, type ScoreOptions } from './score'

// Runtime-neutral source ordering shared by the app and the self-hosted Cloudflare resolver.
// Keep network access and persisted stores out of this module so Workers can bundle the exact
// same ranking implementation that local playback uses.

const cacheRank = (c: CacheState) =>
  c === 'instant' ? 0 : c === 'unknown' ? 1 : c === 'uncached' ? 2 : 3

export interface RankOptions extends ScoreOptions {
  allowUncached?: boolean
  audioLang?: string
  seadexHashes?: ReadonlySet<string>
  cacheCheck?: 'native' | 'library' | 'none'
}

/** A row whose bytes come out of a BitTorrent swarm rather than a plain HTTP host: a bare
 *  infoHash, or a Torrentio-style resolver URL that the direct player turns back into one. */
export const isSwarmRoute = (s: Stream): boolean =>
  (!!s.infoHash && !s.url) || !!torrentioResolverInfoHash(s.url, s.__addonName ?? s.name)

/** Whether the swarm — not a debrid cache — is what will actually deliver this row: every torrent
 *  under direct P2P, and any torrent the debrid has not already cached. Seeders are the health
 *  signal of exactly these rows and noise on the rest. */
export const swarmSupplied = (i: StreamInfo, opts: ScoreOptions): boolean =>
  isSwarmRoute(i.stream) && swarmSupplies(i, opts)

/** Below this many known seeders a swarm is starved: startup stalls on the one or two peers that
 *  exist, whatever the resolution promises. A row that reports no count is NOT starved — an addon
 *  that does not measure tracker health is not evidence of a dead swarm. */
export const STARVED_SWARM_SEEDERS = 5
export const isStarvedSwarm = (i: StreamInfo, opts: ScoreOptions): boolean =>
  swarmSupplied(i, opts) && i.seeders != null && i.seeders < STARVED_SWARM_SEEDERS

// Under direct P2P the debrid's cache is not on the path at all — every torrent is fetched from
// the swarm — so a cache glyph must not sort one torrent above another: an extension's `[⬇]` row
// with 800 seeders used to lose to a Torrentio row with 3 because the glyph read "uncached". Only a
// dead swarm keeps its rank; a plain HTTP stream stays instant, since it really is.
const effectiveCacheState = (i: StreamInfo, opts: RankOptions): CacheState =>
  opts.directP2p && i.cached !== 'down' && isSwarmRoute(i.stream) ? 'unknown' : i.cached
const cacheRankOf = (i: StreamInfo, opts: RankOptions) => cacheRank(effectiveCacheState(i, opts))
const starvedRank = (i: StreamInfo, opts: RankOptions) => (isStarvedSwarm(i, opts) ? 1 : 0)

/** Automatic eligibility by cache state. Under direct P2P the debrid cache check is irrelevant to a
 *  torrent, so every live swarm is eligible; elsewhere unknown rows wait for a native check and
 *  uncached rows need the caller to have opted into a debrid download. */
const cacheEligible = (i: StreamInfo, opts: RankOptions): boolean => {
  if (opts.directP2p && isSwarmRoute(i.stream)) return i.cached !== 'down'
  return i.cached === 'instant'
    || (i.cached === 'unknown' && opts.cacheCheck !== 'native')
    || (!!opts.allowUncached && (i.cached === 'unknown' || i.cached === 'uncached'))
}

const isCurated = (i: StreamInfo, opts: RankOptions) =>
  !!i.stream.infoHash && !!opts.seadexHashes?.has(i.stream.infoHash.toLowerCase())
const curatedFirst = (i: StreamInfo, opts: RankOptions) => (isCurated(i, opts) ? 0 : 1)

function curatedScoreOf(
  infos: StreamInfo[],
  scoreOf: (i: StreamInfo) => number,
  block: (i: StreamInfo) => string,
  opts: RankOptions,
): (i: StreamInfo) => number {
  const lifted = new Map<StreamInfo, number>()
  for (const row of infos) {
    if (!isCurated(row, opts)) continue
    const own = scoreOf(row)
    let tierBest = own
    let better = Infinity
    for (const other of infos) {
      if (other === row || block(other) !== block(row)) continue
      if (other.quality === row.quality) tierBest = Math.max(tierBest, scoreOf(other))
      else if (other.quality > row.quality) better = Math.min(better, scoreOf(other))
    }
    lifted.set(row, Math.max(own, Math.min(tierBest, better - 1)))
  }
  return (i) => lifted.get(i) ?? scoreOf(i)
}

export function languageMismatch(i: StreamInfo, audioLang?: string): boolean {
  if (i.langMismatch) return true
  if (!audioLang || !i.audioLanguages.length) return false
  if (i.dualAudio || i.audioLanguages.includes('multi')) return false
  return !i.audioLanguages.includes(audioLang.toLowerCase().slice(0, 3))
}

export function rankInfos(streams: Stream[], sort: StreamSort = 'quality', opts: RankOptions = {}): StreamInfo[] {
  const infos = streams.map(describe)
  const scored = new Map<StreamInfo, number>()
  const scoreOf = (i: StreamInfo) => {
    let score = scored.get(i)
    if (score == null) {
      score = scoreInfo(i, opts).score
      scored.set(i, score)
    }
    return score
  }
  const mismatch = (i: StreamInfo) => (languageMismatch(i, opts.audioLang) ? 1 : 0)
  // The starved wall is part of the quality order only; explicit seeder/size sorts say otherwise.
  const starved = (i: StreamInfo) => (sort === 'quality' ? starvedRank(i, opts) : 0)
  const rankOf = sort === 'quality'
    ? curatedScoreOf(infos, scoreOf, (i) => `${cacheRankOf(i, opts)}:${mismatch(i)}:${starved(i)}`, opts)
    : scoreOf
  const within = (a: StreamInfo, b: StreamInfo) => {
    if (sort === 'seeders') return (b.seeders ?? -1) - (a.seeders ?? -1) || b.quality - a.quality
    if (sort === 'size') return (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0) || b.quality - a.quality
    return rankOf(b) - rankOf(a) || b.quality - a.quality
      || curatedFirst(a, opts) - curatedFirst(b, opts)
      || scoreOf(b) - scoreOf(a) || (b.seeders ?? -1) - (a.seeders ?? -1)
  }
  return infos.sort((a, b) => cacheRankOf(a, opts) - cacheRankOf(b, opts)
    || mismatch(a) - mismatch(b)
    || starved(a) - starved(b)
    || within(a, b)
    || (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0))
}

export function rankStreams(streams: Stream[], sort: StreamSort = 'quality', opts: RankOptions = {}): Stream[] {
  return rankInfos(streams, sort, opts).map((i) => i.stream)
}

export function pickCandidates(
  streams: Stream[],
  quality: string,
  want?: { season?: number; episode?: number; abs?: number },
  isFailed?: (s: Stream) => boolean,
  opts: RankOptions = {},
): Stream[] {
  const pool = want ? streams.filter((s) => !isWrongSeason(s, want)) : streams
  const all = pool.map(describe).filter((i) => cacheEligible(i, opts))
  if (!all.length) return []
  const preferred = all.filter((i) => !languageMismatch(i, opts.audioLang))
  const target = quality === 'any' ? NaN : Number(quality)
  const cacheFirst = (i: StreamInfo) => cacheRankOf(i, opts)
  // A starved swarm is a wall between the cache key and the tier key: under the tier key alone a
  // 2-seeder 1080p outranked a 900-seeder 720p, and no score could reach across that.
  const starved = (i: StreamInfo) => starvedRank(i, opts)
  const tierRank = (i: StreamInfo) =>
    !Number.isFinite(target) ? 0 : i.quality === target ? 0 : i.quality < target ? 1 : 2
  const audioEligible = preferred.length ? preferred : all
  // Explicitly wrong/missing subtitles are a fallback, not an automatic choice. UNKNOWN remains
  // eligible because Stremio normally cannot reveal embedded MKV tracks until the file is open.
  const subtitlePreferred = audioEligible.filter((i) =>
    subtitleCompatibility(i, opts.subtitleLang) !== 'mismatch')
  const eligible = subtitlePreferred.length ? subtitlePreferred : audioEligible
  const scored = new Map<StreamInfo, number>()
  const scoreOf = (i: StreamInfo) => {
    let score = scored.get(i)
    if (score == null) {
      score = scoreInfo(i, opts).score
      scored.set(i, score)
    }
    return score
  }
  const rankOf = curatedScoreOf(eligible, scoreOf, (i) => `${cacheFirst(i)}:${starved(i)}:${tierRank(i)}`, opts)
  const ordered = eligible.sort((a, b) =>
    cacheFirst(a) - cacheFirst(b)
    || starved(a) - starved(b)
    || tierRank(a) - tierRank(b)
    || rankOf(b) - rankOf(a)
    || b.quality - a.quality
    || curatedFirst(a, opts) - curatedFirst(b, opts)
    || scoreOf(b) - scoreOf(a)
    || (b.seeders ?? -1) - (a.seeders ?? -1))
  const rank = isFailed
    ? ordered.filter((i) => !isFailed(i.stream)).concat(ordered.filter((i) => isFailed(i.stream)))
    : ordered
  return rank.map((i) => i.stream)
}

const DIRECT_AUTO_STARTUP_MAX_BYTES = 2 * 1024 ** 3

export function preferDirectStartupCandidates(candidates: Stream[]): Stream[] {
  const first = candidates[0]
  if (!first) return candidates
  const firstInfo = describe(first)
  if (!first.infoHash || first.url) return candidates
  const sameQuality = candidates.filter((stream) => {
    const info = describe(stream)
    return !!stream.infoHash && !stream.url && info.quality === firstInfo.quality
  })
  const metadataReady = firstInfo.seeders == null && !first.__torrentUrl
    ? sameQuality.filter((stream) => !!stream.__torrentUrl && (describe(stream).seeders ?? 0) > 0)
    : []
  // A smaller file only starts faster when its swarm can actually feed it. Against a leader with a
  // known count the challenger has to keep a real share of that health; against a leader that
  // reports none, only a count that is known to be starved rules it out — size is then the only
  // evidence there is.
  const lead = firstInfo.seeders
  const healthyEnough = (seeders: number | undefined) => lead == null
    ? seeders == null || seeders >= STARVED_SWARM_SEEDERS
    : seeders != null && seeders >= Math.max(STARVED_SWARM_SEEDERS, lead / 4)
  const compact = sameQuality.filter((stream) => {
    const info = describe(stream)
    return healthyEnough(info.seeders)
      && info.sizeBytes != null
      && info.sizeBytes <= DIRECT_AUTO_STARTUP_MAX_BYTES
  })
  const faster = [...new Set([...metadataReady, ...compact])]
  if (!faster.length || faster[0] === first) return candidates
  const promoted = new Set(faster)
  return [...faster, ...candidates.filter((stream) => !promoted.has(stream))]
}

export function pickBest(
  streams: Stream[],
  quality: string,
  want?: { season?: number; episode?: number; abs?: number },
  opts: RankOptions | 'native' | 'library' | 'none' = {},
): Stream | undefined {
  const options = typeof opts === 'string' ? { cacheCheck: opts } : opts
  return pickCandidates(streams, quality, want, undefined, options)[0]
}
