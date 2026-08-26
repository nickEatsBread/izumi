import { phttp } from '$lib/net/http'
import { describe, isNotice, isUncached, isWrongSeason, type Stream, type StreamInfo, type CacheState, type StreamSort } from './parse'
import { fetchManifest, acceptsStreamId } from './manifest'
import { addonOriginId } from './sources'
import { dedupeStreams } from './dedupe'
import { scoreInfo, type ScoreOptions } from './score'
import { resolveAddonLogo } from './addon-logo'
import { normalizeStreamBehavior } from './stream-behavior'

// Re-export the parse surface so existing importers keep using `$lib/stremio/addon`.
export {
  describe, qualityLabel, resolutionOf, isCached, isUncached, isNotice, parseSeasonEp, isWrongSeason,
} from './parse'
export type { Stream, StreamInfo, CacheState, StreamSort } from './parse'

export const streamId = (kitsuId: number, episode?: number) =>
  episode != null ? `kitsu:${kitsuId}:${episode}` : `kitsu:${kitsuId}`

// Cached always outranks unknown outranks uncached outranks dead — no uncached or dead source
// ever sits above a playable one regardless of quality/seeders. 'unknown' sits between: it is not
// evidence of caching, but it is not evidence against it either.
const cacheRank = (c: CacheState) =>
  c === 'instant' ? 0 : c === 'unknown' ? 1 : c === 'uncached' ? 2 : 3

// A source in a language the user didn't ask for sorts below one that is (or one whose language is
// unknown — never drop or demote on silence). This has to be a RANKING term, not just presentation:
// every direct-stream row is `instant` with quality "auto", so cache tier and quality tie and
// whatever arrived first won — which is how a foreign-language provider ended up auto-selected as
// "best". It used to apply only to direct-stream rows, because only those carried a resolved
// language; torrent rows now declare one too when their name names it.
export interface RankOptions extends ScoreOptions {
  /** Let the automatic pick commit to a source that still has to be fetched to debrid. Off by
   *  default: dropping someone into a multi-minute download unasked is the thing this guards.
   *  On when the user has chosen to skip the confirmation countdown entirely, since every source
   *  a torrent-extension returns is uncached by construction and the pick would otherwise be
   *  permanently unavailable for them. */
  allowUncached?: boolean
  /** Preferred spoken-audio language (ISO-ish 3-letter). A release that NAMES a different one
   *  sorts below; a release that names none is not a mismatch, which is the common case. */
  audioLang?: string
  /** Lowercased infoHashes of the releases a curated database recommends for this title. Empty or
   *  absent whenever the annotation is off, uncached or simply unknown, which is the common case. */
  seadexHashes?: ReadonlySet<string>
  /** Cache knowledge exposed by the selected debrid provider. Native checks may treat an
   * unanswered hash as unavailable; library-only and unsupported providers keep it unknown. */
  cacheCheck?: 'native' | 'library' | 'none'
}

// A human compared these releases frame by frame, which is better evidence than anything scoreInfo
// infers from a filename — but it is evidence about which RELEASE is best, not about which
// RESOLUTION is. So it can be neither points nor an outer key: as points it would have to outweigh
// group continuity (12) to decide the case it exists for, and 12 also buys a whole resolution tier
// (1080p → 720p is 12 points, 1440p → 1080p is 2); as the leading key it did the very thing it is
// meant to be subordinate to, putting a curated 480p above a plain 2160p.
const isCurated = (i: StreamInfo, opts: RankOptions) =>
  !!i.stream.infoHash && !!opts.seadexHashes?.has(i.stream.infoHash.toLowerCase())
const curatedFirst = (i: StreamInfo, opts: RankOptions) => (isCurated(i, opts) ? 0 : 1)

/** The value the default sort compares, with the curated promotion folded in.
 *
 *  Curation has to clear the within-tier score to decide the case it exists for — the recommended
 *  release is routinely the twenty-seeder row beside a wall of nine-hundred-seeder ones — while
 *  never lifting a release past a better resolution. Those two rules cannot be applied pairwise:
 *  "curation wins within a resolution, the score wins across one" is not an ordering at all
 *  (curated 1080p > plain 1080p > plain 1440p > curated 1080p) and Array.sort may return anything
 *  for a comparator that contradicts itself. So the promotion is folded into the number already
 *  being compared: a curated row carries the best score its OWN resolution reached, capped below
 *  the weakest row of any better resolution, and never below what it scored by itself. Turning the
 *  annotation on can therefore only move a release up past equal-or-lower resolutions — never past
 *  a higher one, and never down (a preference that demotes the release it recommends is a bug too).
 *
 *  `block` names the rows that can actually end up adjacent, since the harder keys separate the
 *  rest: an uncached 1440p must not cap a curated row sitting in the cached half of the list. */
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
    // Every term in the score is an integer, so `better - 1` is a strict cap rather than a tie.
    lifted.set(row, Math.max(own, Math.min(tierBest, better - 1)))
  }
  return (i) => lifted.get(i) ?? scoreOf(i)
}

/** Does this release positively declare an audio language the user did not ask for? */
export function languageMismatch(i: StreamInfo, audioLang?: string): boolean {
  if (i.langMismatch) return true // already resolved upstream for direct-stream rows
  if (!audioLang || !i.audioLanguages.length) return false
  if (i.dualAudio || i.audioLanguages.includes('multi')) return false
  return !i.audioLanguages.includes(audioLang.toLowerCase().slice(0, 3))
}

// Rank into StreamInfo: cache tier first, then language, then the user's preferred within-tier
// key. `quality` (the default) settles on the additive score, resolution included — anime returns a
// wall of 1080p rows, and the old ladder had nothing but seeders left to separate them — with the
// curated recommendation promoted inside its own resolution. The explicit `seeders` and `size`
// sorts stay single-key: the user asked a literal question and should get a literal answer.
export function rankInfos(streams: Stream[], sort: StreamSort = 'quality', opts: RankOptions = {}): StreamInfo[] {
  const infos = streams.map(describe)
  const scored = new Map<StreamInfo, number>()
  const scoreOf = (i: StreamInfo) => {
    let s = scored.get(i)
    if (s == null) { s = scoreInfo(i, opts).score; scored.set(i, s) }
    return s
  }
  const mismatch = (i: StreamInfo) => (languageMismatch(i, opts.audioLang) ? 1 : 0)
  const rankOf = sort === 'quality'
    ? curatedScoreOf(infos, scoreOf, (i) => `${cacheRank(i.cached)}:${mismatch(i)}`, opts)
    : scoreOf
  const within = (a: StreamInfo, b: StreamInfo) => {
    // The explicit sorts stay literal — a curated row must not jump a list the user asked to have
    // ordered by seeders, which would answer a different question than the one they asked.
    if (sort === 'seeders') return (b.seeders ?? -1) - (a.seeders ?? -1) || b.quality - a.quality
    if (sort === 'size') return (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0) || b.quality - a.quality
    // Resolution ABOVE the curated key, not below it: the promotion already refuses to cross a
    // resolution, and this settles the case where it lands exactly on one. Curation then separates
    // what the score left tied, which is the whole of what a tie-break may do.
    return rankOf(b) - rankOf(a) || b.quality - a.quality
      || curatedFirst(a, opts) - curatedFirst(b, opts)
      || scoreOf(b) - scoreOf(a) || (b.seeders ?? -1) - (a.seeders ?? -1)
  }
  return infos
    .sort((a, b) => cacheRank(a.cached) - cacheRank(b.cached)
      || mismatch(a) - mismatch(b)
      || within(a, b)
      || (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0))
}

export function rankStreams(streams: Stream[], sort: StreamSort = 'quality', opts: RankOptions = {}): Stream[] {
  return rankInfos(streams, sort, opts).map((i) => i.stream)
}

// Auto-select order for a preferred quality: every source we would be willing to start on
// automatically, best first. Cached sources lead, and only they are eligible at all unless
// `allowUncached` is set — we never silently drop the user into a debrid download or a
// wrong-season file. `want` (the requested episode/season/absolute number)
// hard-drops confident mismatches BEFORE ranking, so a high-seeder wrong episode/season can't
// win. `isFailed` sinks (never removes) sources a previous attempt could not play.
//
// Returning the whole ordered list, rather than just the winner, is what lets a failed automatic
// pick advance to the next candidate instead of dead-ending in the error state.
export function pickCandidates(
  streams: Stream[],
  quality: string,
  want?: { season?: number; episode?: number; abs?: number },
  isFailed?: (s: Stream) => boolean,
  opts: RankOptions = {},
): Stream[] {
  const pool = want ? streams.filter((s) => !isWrongSeason(s, want)) : streams
  // 'down' stays excluded either way — that is a source with nothing to fetch FROM.
  const all = pool.map(describe).filter((i) =>
    i.cached === 'instant'
    || (i.cached === 'unknown' && opts.cacheCheck !== 'native')
    || (opts.allowUncached && (i.cached === 'unknown' || i.cached === 'uncached')))
  if (!all.length) return []
  // Auto-select must never silently commit to a foreign-language source. Applied as a hard filter
  // rather than a sort key: sorting alone still let a foreign source win when it was the only one
  // matching the requested quality tier.
  const preferred = all.filter((i) => !languageMismatch(i, opts.audioLang))
  const target = quality === 'any' ? NaN : Number(quality)
  // Cache state OUTRANKS the quality preference. It used to be the other way round, because the
  // tier preference was applied as a partition AFTER the cache ordering and so silently overrode
  // it: with Quality on 4K, one uncached 2160p release was picked ahead of eleven cached 1080p
  // copies, committing to a multi-gigabyte download when the episode could have started at once.
  // Asking for 4K expresses which copy you would rather have, not a willingness to wait for it.
  const cacheFirst = (i: StreamInfo) => cacheRank(i.cached)
  const tierRank = (i: StreamInfo) =>
    !Number.isFinite(target) ? 0 : i.quality === target ? 0 : i.quality < target ? 1 : 2
  const eligible = preferred.length ? preferred : all
  const scored = new Map<StreamInfo, number>()
  const scoreOf = (i: StreamInfo) => {
    let s = scored.get(i)
    if (s == null) { s = scoreInfo(i, opts).score; scored.set(i, s) }
    return s
  }
  // Same promotion the list uses, so the row wearing the "Best" pill is the row the list leads
  // with. Blocked by the keys above it: only rows the tier preference already grouped together
  // can be reordered by curation.
  const rankOf = curatedScoreOf(eligible, scoreOf, (i) => `${cacheFirst(i)}:${tierRank(i)}`, opts)
  const ordered = eligible.sort((a, b) =>
    cacheFirst(a) - cacheFirst(b)
    || tierRank(a) - tierRank(b)
    // BELOW the tier the user asked for, so curation can never talk the automatic pick out of it,
    // and below resolution within that tier. With Quality on "any" tierRank is inert by
    // construction, so curation used to decide there outright — which handed back a curated 480p
    // over a plain 2160p, the opposite of a tie-break. "Any" means highest available; the curators'
    // verdict settles which release at that resolution, not which resolution.
    || rankOf(b) - rankOf(a)
    || b.quality - a.quality
    || curatedFirst(a, opts) - curatedFirst(b, opts)
    || scoreOf(b) - scoreOf(a)
    || (b.seeders ?? -1) - (a.seeders ?? -1))
  // A remembered failure is a hint, not a verdict — a debrid hiccup and an expired token look the
  // same from here, so failed sources go last rather than away.
  const rank = isFailed ? ordered.filter((i) => !isFailed(i.stream)).concat(ordered.filter((i) => isFailed(i.stream))) : ordered
  return rank.map((i) => i.stream)
}

const DIRECT_AUTO_STARTUP_MAX_BYTES = 2 * 1024 ** 3

/** Keep automatic direct playback inside the selected quality tier, but prefer candidates whose
 * startup is less likely to stall. A hash-pinned metadata URL with confirmed peers outranks an
 * unknown-health bare hash because it skips DHT metadata discovery; otherwise streamable-size
 * episodes lead multi-gigabyte archival encodes. The full ranked chain remains as fallback. */
export function preferDirectStartupCandidates(candidates: Stream[]): Stream[] {
  const first = candidates[0]
  if (!first) return candidates
  const firstInfo = describe(first)
  if (!first.infoHash || first.url) return candidates
  const sameQuality = candidates.filter((stream) => {
    const info = describe(stream)
    return !!stream.infoHash
      && !stream.url
      && info.quality === firstInfo.quality
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

/** The single best auto-pick — the head of the candidate list. Undefined when nothing is cached. */
export function pickBest(
  streams: Stream[],
  quality: string,
  want?: { season?: number; episode?: number; abs?: number },
  opts: RankOptions | 'native' | 'library' | 'none' = {},
): Stream | undefined {
  const options = typeof opts === 'string' ? { cacheCheck: opts } : opts
  return pickCandidates(streams, quality, want, undefined, options)[0]
}

// Query all configured addons for an episode. Keeps every USABLE stream (has a
// resolved url or an infoHash, and isn't a notice/error sentinel) — including
// uncached ones, so the picker can show + flag them (auto-play stays cached-only
// via pickBest). Returns the ranked list, the total stream count (to tell "no
// torrents" from "torrents but none usable"), and the cached count for the header.
// Uses the Tauri HTTP plugin (Rust reqwest) to bypass the webview's CORS +
// mixed-content restrictions and follow http->https redirects.
export async function getStreams(
  bases: string[],
  id: string | string[],
  type = 'series',
  sort: StreamSort = 'quality',
): Promise<{ streams: Stream[]; total: number; cachedCount: number }> {
  const results = await Promise.all(bases.map((b) => fetchAddonStreams(b, id, type)))
  const usable = results.flatMap((r) => r.streams)
  const total = results.reduce((n, r) => n + r.total, 0)
  const cachedCount = usable.filter((s) => !!s.url && !isUncached(s)).length
  return { streams: rankStreams(usable, sort), total, cachedCount }
}

export interface AddonStreams { streams: Stream[]; total: number }

// Per-addon time budget. A flat cap can only be wrong in one of two directions: addons that
// run a real-time debrid cache check before answering (they resolve every hash against the
// service) legitimately need far longer than an indexer that just returns rows, so a cap tight
// enough to keep the picker responsive silently starved exactly the sources that carry season
// packs. Matched against the whole configured URL — the family name shows up in the host for a
// self-hosted instance and in the path for a shared one.
const BUDGET_FAST_MS = 8_000
const BUDGET_SLOW_MS = 22_000
const SLOW_FAMILIES = [/mediafusion/i, /comet/i, /torrentio/i, /knightcrawler/i, /aiostreams/i, /jackettio/i, /torbox/i]
export const streamBudgetMs = (base: string) =>
  SLOW_FAMILIES.some((re) => re.test(base)) ? BUDGET_SLOW_MS : BUDGET_FAST_MS

// Fetch ONE addon's usable streams (has a url/infoHash, not a notice), stamped with
// its manifest logo/name. Split out from getStreams so the picker can fold each addon
// in AS IT RESPONDS (progressive loading) instead of waiting on the
// slowest. `total` is the raw count (incl. notices) for the "N torrents, none usable"
// message.
//
// Blowing the budget is not the same as failing: `onLate` receives the response if it lands
// afterwards, so a slow addon's rows still reach an open picker instead of being thrown away
// (they were, previously — a response one tick past the cap was discarded outright).
//
// `signal`, when passed, rides only the stream request (never the manifest — see below): a
// picker supersede aborts the in-flight fetch instead of leaving it to run to completion against
// the shared native HTTP pool, freeing the slot immediately for whatever the new pick needs.
export async function fetchAddonStreams(
  base: string,
  id: string | string[],
  type = 'series',
  onLate?: (r: AddonStreams) => void,
  signal?: AbortSignal,
): Promise<AddonStreams> {
  let b = base.replace(/^http:\/\//i, 'https://')
  if (!/^https?:\/\//i.test(b)) b = 'https://' + b
  const ids = Array.isArray(id) ? id : [id]

  // The manifest carries IDENTITY (logo + display name), never content, so it must never gate
  // the streams: joining the two under one await meant a host whose /manifest.json hung returned
  // ZERO streams even when /stream had answered in a few hundred ms. It now rides alongside and
  // stamps whatever has landed by the time rows are mapped — which, because manifests are
  // pre-warmed at boot and cached for the session, is the manifest itself in the normal case.
  //
  // It is ALSO what tells us which ids this addon accepts. That gate is only applied when the
  // manifest is already known: waiting for it to decide whether to ask would put the identity
  // fetch back on the critical path, and an unnecessary request costs far less than a missed one.
  let manifest: Awaited<ReturnType<typeof fetchManifest>> | undefined
  const manifestReady = fetchManifest(b).then((m) => { manifest = m }).catch(() => {})
  void manifestReady

  const askable = () => {
    const usable = ids.filter((i) => acceptsStreamId(manifest ?? null, type, i))
    // Every id rejected while the manifest IS known means this addon genuinely serves none of
    // them. Asking anyway would only add a request whose empty answer we already predicted.
    return usable
  }

  // The JS race below only decides when izumi STOPS WAITING; without a native deadline the
  // dropped request kept running to the backend's 30s default while still holding one of the
  // twelve slots in the shared HTTP pool, starving the metadata/manifest/subtitle traffic on the
  // same lane. The grace keeps the native timeout strictly behind the budget, so a response that
  // is merely a tick late still reaches `onLate` instead of being cancelled out from under it.
  const budgetMs = streamBudgetMs(b)
  const deadlineMs = budgetMs + 5_000

  const work = (async (): Promise<AddonStreams> => {
    try {
      const ask = askable()
      if (!ask.length) return { streams: [], total: 0 }
      // One request per accepted id, in parallel. A title with both an anime id and an aligned
      // imdb triple reaches addons in either namespace instead of only the anime-aware ones.
      const responses = await Promise.all(ask.map(async (one) => {
        try {
          const r = await phttp(`${b}/stream/${type}/${encodeURIComponent(one)}.json`, { signal, timeoutMs: deadlineMs })
          if (!r.ok) return []
          return ((await r.json()) as { streams?: Stream[] }).streams ?? []
        } catch { return [] }
      }))
      const all = responses.flat().map((s) => normalizeStreamBehavior({
        ...s,
        __logo: resolveAddonLogo(manifest?.logo, b),
        __addonName: manifest?.name,
        __origin: { kind: 'addon' as const, id: addonOriginId(b), name: manifest?.name },
      }))
      const usable = dedupeStreams(all.filter((s) => (!!s.url || !!s.infoHash) && !isNotice(s)))
      return { streams: usable, total: all.length }
    } catch { return { streams: [], total: 0 } }
  })()

  let lapsed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const budget = new Promise<AddonStreams>((res) => {
    timer = setTimeout(() => { lapsed = true; res({ streams: [], total: 0 }) }, budgetMs)
  })
  void work.then((r) => {
    if (timer) clearTimeout(timer)
    // Nothing to fold in for an empty late response — firing would cost the picker a full
    // re-rank + re-render for no new rows.
    if (lapsed && r.streams.length) onLate?.(r)
  })
  return Promise.race([work, budget])
}
