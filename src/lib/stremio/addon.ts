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
    .sort((a, b) => cacheRank(a.cached) - cacheRank(b.cached) || within(a, b) || (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0))
}

export function rankStreams(streams: Stream[], sort: StreamSort = 'quality'): Stream[] {
  return rankInfos(streams, sort).map((i) => i.stream)
}

// Auto-select the best source for a preferred quality. Only ever commits to a
// CACHED (instant) stream — we never silently drop the user into a debrid
// download or a wrong-season file. `want` (the requested episode's season/abs)
// hard-drops confident wrong-season files BEFORE ranking, so a high-seeder
// off-season batch can't win the auto-pick. Returns undefined when nothing is
// cached, so callers fall back to the picker.
export function pickBest(streams: Stream[], quality: string, want?: { season?: number; abs?: number }): Stream | undefined {
  const pool = want ? streams.filter((s) => !isWrongSeason(s, want)) : streams
  const infos = pool.map(describe).filter((i) => i.cached === 'instant')
  if (!infos.length) return undefined
  const byRank = infos.sort((a, b) => b.quality - a.quality || (b.seeders ?? -1) - (a.seeders ?? -1))
  if (quality === 'any') return byRank[0].stream
  const target = Number(quality)
  return (byRank.find((i) => i.quality === target)
    ?? byRank.filter((i) => i.quality <= target)[0]
    ?? byRank[0]).stream
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

// Fetch ONE addon's usable streams (has a url/infoHash, not a notice), stamped with
// its manifest logo/name. Split out from getStreams so the picker can fold each addon
// in AS IT RESPONDS (progressive loading) instead of waiting on the
// slowest. `total` is the raw count (incl. notices) for the "N torrents, none usable"
// message. Capped at 9s so one hanging addon can't stall.
export async function fetchAddonStreams(
  base: string,
  id: string,
  type = 'series',
): Promise<{ streams: Stream[]; total: number }> {
  let b = base.replace(/^http:\/\//i, 'https://')
  if (!/^https?:\/\//i.test(b)) b = 'https://' + b
  const work = (async () => {
    try {
      // Stream list + manifest (logo/name) fetched CONCURRENTLY; a manifest miss must
      // not drop the streams, so it's independently caught.
      const [r, m] = await Promise.all([
        phttp(`${b}/stream/${type}/${encodeURIComponent(id)}.json`),
        fetchManifest(b).catch(() => undefined),
      ])
      if (!r.ok) return { streams: [], total: 0 }
      const j = await r.json() as { streams?: Stream[] }
      const all = (j.streams ?? []).map((s) => ({
        ...s,
        __logo: m?.logo,
        __addonName: m?.name,
        __origin: { kind: 'addon' as const, id: addonOriginId(b), name: m?.name },
      }))
      const usable = all.filter((s) => (!!s.url || !!s.infoHash) && !isNotice(s))
      return { streams: usable, total: all.length }
    } catch { return { streams: [], total: 0 } }
  })()
  return Promise.race([work, new Promise<{ streams: Stream[]; total: number }>((res) => setTimeout(() => res({ streams: [], total: 0 }), 9000))])
}
