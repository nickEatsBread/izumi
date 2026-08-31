import { phttp } from '$lib/net/http'
import { isNotice, isUncached, type Stream, type StreamSort } from './parse'
import { fetchManifest, acceptsStreamId, peekManifest } from './manifest'
import { addonOriginId } from './sources'
import { dedupeStreams } from './dedupe'
import { rankStreams } from './ranking'
import { resolveAddonLogo } from './addon-logo'
import { normalizeStreamBehavior } from './stream-behavior'

// Re-export the parse surface so existing importers keep using `$lib/stremio/addon`.
export {
  describe, qualityLabel, resolutionOf, isCached, isUncached, isNotice, parseSeasonEp, isWrongSeason,
} from './parse'
export type { Stream, StreamInfo, CacheState, StreamSort } from './parse'
export {
  languageMismatch, pickBest, pickCandidates, preferDirectStartupCandidates, rankInfos, rankStreams,
} from './ranking'
export type { RankOptions } from './ranking'

export const streamId = (kitsuId: number, episode?: number) =>
  episode != null ? `kitsu:${kitsuId}:${episode}` : `kitsu:${kitsuId}`

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

// A deliberate play-intent prefetch is short-lived because addon URLs can carry expiring tokens.
// Keep the full in-flight promise so a click can join the exact HTTP request hover/focus started,
// rather than merely reusing its result after both requests have already gone over the wire.
export const STREAM_PREFETCH_TTL_MS = 20_000
const streamPrefetches = new Map<string, { expiresAt: number; promise: Promise<AddonStreams> }>()

const normalizedAddonBase = (base: string) => {
  let value = base.replace(/^http:\/\//i, 'https://')
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`
  return value
}

const streamPrefetchKey = (base: string, id: string | string[], type: string) =>
  `${normalizedAddonBase(base)}|${type}|${JSON.stringify(Array.isArray(id) ? id : [id])}`

export function clearStreamPrefetches(): void {
  streamPrefetches.clear()
}

/** Warm one exact Stremio stream resource after a clear pointer/focus intent. */
export function prefetchAddonStreams(
  base: string,
  id: string | string[],
  type = 'series',
): Promise<AddonStreams> {
  const cacheKey = streamPrefetchKey(base, id, type)
  const existing = streamPrefetches.get(cacheKey)
  if (existing && existing.expiresAt > Date.now()) return existing.promise
  if (existing) streamPrefetches.delete(cacheKey)

  // fetchAddonStreams checks the cache before this entry is installed, so this call creates the
  // one underlying request. Empty/timed-out results are not retained: the real click gets a fresh
  // attempt instead of inheriting a speculative miss.
  const promise = fetchAddonStreams(base, id, type).then((result) => {
    if (!result.streams.length && streamPrefetches.get(cacheKey)?.promise === promise) {
      streamPrefetches.delete(cacheKey)
    }
    return result
  })
  streamPrefetches.set(cacheKey, { expiresAt: Date.now() + STREAM_PREFETCH_TTL_MS, promise })
  return promise
}

function joinPrefetch(
  promise: Promise<AddonStreams>,
  signal?: AbortSignal,
): Promise<AddonStreams> {
  if (!signal) return promise
  if (signal.aborted) return Promise.resolve({ streams: [], total: 0 })
  return new Promise((resolve) => {
    const abort = () => resolve({ streams: [], total: 0 })
    signal.addEventListener('abort', abort, { once: true })
    void promise.then((result) => {
      signal.removeEventListener('abort', abort)
      if (!signal.aborted) resolve(result)
    })
  })
}

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
  const b = normalizedAddonBase(base)
  const ids = Array.isArray(id) ? id : [id]
  const cacheKey = streamPrefetchKey(b, ids, type)
  const prefetched = streamPrefetches.get(cacheKey)
  if (prefetched) {
    if (prefetched.expiresAt > Date.now()) return joinPrefetch(prefetched.promise, signal)
    streamPrefetches.delete(cacheKey)
  }

  // The manifest carries IDENTITY (logo + display name), never content, so it must never gate
  // the streams: joining the two under one await meant a host whose /manifest.json hung returned
  // ZERO streams even when /stream had answered in a few hundred ms. It now rides alongside and
  // stamps whatever has landed by the time rows are mapped — which, because manifests are
  // pre-warmed at boot and cached for the session, is the manifest itself in the normal case.
  //
  // It is ALSO what tells us which ids this addon accepts. That gate is only applied when the
  // manifest is already known: waiting for it to decide whether to ask would put the identity
  // fetch back on the critical path, and an unnecessary request costs far less than a missed one.
  let manifest: Awaited<ReturnType<typeof fetchManifest>> | undefined = peekManifest(b)
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
      const all = responses.flatMap((streams, requestIndex) => streams.map((s, upstreamRank) => normalizeStreamBehavior({
        ...s,
        __logo: resolveAddonLogo(manifest?.logo, b),
        __addonName: manifest?.name,
        __origin: { kind: 'addon' as const, id: addonOriginId(b), name: manifest?.name },
        __evidence: { upstreamRank, requestId: ask[requestIndex] },
      })))
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
