import { describe, isWrongSeason, type CacheState, type Stream, type StreamInfo, type StreamSort } from './parse'
import { scoreInfo, type ScoreOptions } from './score'

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
  const rankOf = sort === 'quality'
    ? curatedScoreOf(infos, scoreOf, (i) => `${cacheRank(i.cached)}:${mismatch(i)}`, opts)
    : scoreOf
  const within = (a: StreamInfo, b: StreamInfo) => {
    if (sort === 'seeders') return (b.seeders ?? -1) - (a.seeders ?? -1) || b.quality - a.quality
    if (sort === 'size') return (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0) || b.quality - a.quality
    return rankOf(b) - rankOf(a) || b.quality - a.quality
      || curatedFirst(a, opts) - curatedFirst(b, opts)
      || scoreOf(b) - scoreOf(a) || (b.seeders ?? -1) - (a.seeders ?? -1)
  }
  return infos.sort((a, b) => cacheRank(a.cached) - cacheRank(b.cached)
    || mismatch(a) - mismatch(b)
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
  const all = pool.map(describe).filter((i) =>
    i.cached === 'instant'
    || (i.cached === 'unknown' && opts.cacheCheck !== 'native')
    || (opts.allowUncached && (i.cached === 'unknown' || i.cached === 'uncached')))
  if (!all.length) return []
  const preferred = all.filter((i) => !languageMismatch(i, opts.audioLang))
  const target = quality === 'any' ? NaN : Number(quality)
  const cacheFirst = (i: StreamInfo) => cacheRank(i.cached)
  const tierRank = (i: StreamInfo) =>
    !Number.isFinite(target) ? 0 : i.quality === target ? 0 : i.quality < target ? 1 : 2
  const eligible = preferred.length ? preferred : all
  const scored = new Map<StreamInfo, number>()
  const scoreOf = (i: StreamInfo) => {
    let score = scored.get(i)
    if (score == null) {
      score = scoreInfo(i, opts).score
      scored.set(i, score)
    }
    return score
  }
  const rankOf = curatedScoreOf(eligible, scoreOf, (i) => `${cacheFirst(i)}:${tierRank(i)}`, opts)
  const ordered = eligible.sort((a, b) =>
    cacheFirst(a) - cacheFirst(b)
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
  const compact = sameQuality.filter((stream) => {
    const info = describe(stream)
    return info.seeders !== 0
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
