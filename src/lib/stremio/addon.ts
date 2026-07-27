import { phttp } from '$lib/net/http'
import { describe, isNotice, isUncached, isWrongSeason, type Stream, type StreamInfo, type CacheState, type StreamSort } from './parse'
import { fetchManifest } from './manifest'
import { addonOriginId } from './sources'

// Re-export the parse surface so existing importers keep using `$lib/stremio/addon`.
export {
  describe, qualityLabel, resolutionOf, isCached, isUncached, isNotice, parseSeasonEp, isWrongSeason,
} from './parse'
export type { Stream, StreamInfo, CacheState, StreamSort } from './parse'

export const streamId = (kitsuId: number, episode?: number) =>
  episode != null ? `kitsu:${kitsuId}:${episode}` : `kitsu:${kitsuId}`

// Cached always outranks uncached outranks dead — no uncached/dead source ever
// sits above a playable one regardless of quality/seeders.
const cacheRank = (c: CacheState) => (c === 'instant' ? 0 : c === 'uncached' ? 1 : 2)

// A source in a language the user didn't ask for sorts below one that is (or one whose language is
// unknown, which is every torrent row — so this never reshuffles the addon/torrent list). This has
// to be a RANKING term, not just presentation: every direct-stream row is `instant` with quality
// "auto", so cache tier and quality tie and whatever arrived first won — which is how an Italian
// provider ended up auto-selected as "best".
const langRank = (i: { langMismatch?: boolean }) => (i.langMismatch ? 1 : 0)

// Rank into StreamInfo: cache tier first, then the user's preferred within-tier
// key (quality desc default; seeders desc; size desc), with sensible tie-breaks.
export function rankInfos(streams: Stream[], sort: StreamSort = 'quality'): StreamInfo[] {
  const within = (a: StreamInfo, b: StreamInfo) => {
    if (sort === 'seeders') return (b.seeders ?? -1) - (a.seeders ?? -1) || b.quality - a.quality
    if (sort === 'size') return (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0) || b.quality - a.quality
    return b.quality - a.quality || (b.seeders ?? -1) - (a.seeders ?? -1)
  }
  return streams
    .map(describe)
    .sort((a, b) => cacheRank(a.cached) - cacheRank(b.cached)
      || langRank(a) - langRank(b)
      || within(a, b)
      || (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0))
}

export function rankStreams(streams: Stream[], sort: StreamSort = 'quality'): Stream[] {
  return rankInfos(streams, sort).map((i) => i.stream)
}

// Auto-select order for a preferred quality: every source we would be willing to start on
// automatically, best first. Only ever CACHED (instant) sources — we never silently drop the user
// into a debrid download or a wrong-season file. `want` (the requested episode's season/abs)
// hard-drops confident wrong-season files BEFORE ranking, so a high-seeder off-season batch can't
// win. `isFailed` sinks (never removes) sources a previous attempt could not play.
//
// Returning the whole ordered list, rather than just the winner, is what lets a failed automatic
// pick advance to the next candidate instead of dead-ending in the error state.
export function pickCandidates(
  streams: Stream[],
  quality: string,
  want?: { season?: number; abs?: number },
  isFailed?: (s: Stream) => boolean,
): Stream[] {
  const pool = want ? streams.filter((s) => !isWrongSeason(s, want)) : streams
  const all = pool.map(describe).filter((i) => i.cached === 'instant')
  if (!all.length) return []
  // Auto-select must never silently commit to a foreign-language source. Applied as a hard filter
  // rather than a sort key: sorting alone still let a foreign source win when it was the only one
  // matching the requested quality tier.
  const preferred = all.filter((i) => !i.langMismatch)
  const infos = (preferred.length ? preferred : all)
    .sort((a, b) => b.quality - a.quality || (b.seeders ?? -1) - (a.seeders ?? -1))
  const target = quality === 'any' ? NaN : Number(quality)
  const ordered = Number.isFinite(target)
    ? [
        ...infos.filter((i) => i.quality === target),
        ...infos.filter((i) => i.quality < target),
        ...infos.filter((i) => i.quality > target),
      ]
    : infos
  // A remembered failure is a hint, not a verdict — a debrid hiccup and an expired token look the
  // same from here, so failed sources go last rather than away.
  const rank = isFailed ? ordered.filter((i) => !isFailed(i.stream)).concat(ordered.filter((i) => isFailed(i.stream))) : ordered
  return rank.map((i) => i.stream)
}

/** The single best auto-pick — the head of the candidate list. Undefined when nothing is cached. */
export function pickBest(streams: Stream[], quality: string, want?: { season?: number; abs?: number }): Stream | undefined {
  return pickCandidates(streams, quality, want)[0]
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
  id: string,
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
export async function fetchAddonStreams(
  base: string,
  id: string,
  type = 'series',
  onLate?: (r: AddonStreams) => void,
): Promise<AddonStreams> {
  let b = base.replace(/^http:\/\//i, 'https://')
  if (!/^https?:\/\//i.test(b)) b = 'https://' + b

  // The manifest carries IDENTITY (logo + display name), never content, so it must never gate
  // the streams: joining the two under one await meant a host whose /manifest.json hung returned
  // ZERO streams even when /stream had answered in a few hundred ms. It now rides alongside and
  // stamps whatever has landed by the time rows are mapped — which, because manifests are
  // pre-warmed at boot and cached for the session, is the manifest itself in the normal case.
  let manifest: Awaited<ReturnType<typeof fetchManifest>> | undefined
  void fetchManifest(b).then((m) => { manifest = m }).catch(() => {})

  const work = (async (): Promise<AddonStreams> => {
    try {
      const r = await phttp(`${b}/stream/${type}/${encodeURIComponent(id)}.json`)
      if (!r.ok) return { streams: [], total: 0 }
      const j = await r.json() as { streams?: Stream[] }
      const all = (j.streams ?? []).map((s) => ({
        ...s,
        __logo: manifest?.logo,
        __addonName: manifest?.name,
        __origin: { kind: 'addon' as const, id: addonOriginId(b), name: manifest?.name },
      }))
      const usable = all.filter((s) => (!!s.url || !!s.infoHash) && !isNotice(s))
      return { streams: usable, total: all.length }
    } catch { return { streams: [], total: 0 } }
  })()

  let lapsed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const budget = new Promise<AddonStreams>((res) => {
    timer = setTimeout(() => { lapsed = true; res({ streams: [], total: 0 }) }, streamBudgetMs(b))
  })
  void work.then((r) => {
    if (timer) clearTimeout(timer)
    // Nothing to fold in for an empty late response — firing would cost the picker a full
    // re-rank + re-render for no new rows.
    if (lapsed && r.streams.length) onLate?.(r)
  })
  return Promise.race([work, budget])
}
