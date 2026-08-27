import type { Media } from '$lib/anilist/types'
import { normalizeTorrentCount, type TorrentResult, type TorrentQuery } from './types'
import { runningTorrentProviderExtensions } from './manager'
import { currentResolveTrace, traceResolve, traceResolveError } from '$lib/debug/resolve-trace'
import { extensionSourceScheduler } from './source-scheduler'

// anime-torrent-provider SDK shapes. Fields we consume.
export interface SnMedia {
  id: number; idMal?: number; status: string; format: string
  englishTitle?: string; romajiTitle: string; episodeCount: number
  synonyms: string[]; isAdult: boolean; startDate?: { year?: number; month?: number; day?: number }
}
export interface AnimeTorrent {
  name?: string; size?: number; seeders?: number | string; leechers?: number | string; downloadCount?: number | string
  link?: string; downloadUrl?: string; magnetLink?: string; infoHash?: string
  date?: string; resolution?: string; isBatch?: boolean; episodeNumber?: number; releaseGroup?: string
  isBestRelease?: boolean; confirmed?: boolean
}
export interface AtpSettings { canSmartSearch?: boolean; smartSearchFilters?: string[]; type?: string }

/** izumi Media → the provider Media context passed to search/smartSearch. */
export function toProviderMedia(m: Media): SnMedia {
  return {
    id: m.id,
    idMal: m.idMal,
    status: m.status ?? 'NOT_YET_RELEASED',
    format: m.format ?? 'TV',
    englishTitle: m.title.english,
    romajiTitle: m.title.romaji ?? m.title.userPreferred ?? '',
    episodeCount: m.episodes ?? -1,
    synonyms: m.synonyms ?? [],
    // Media doesn't carry an isAdult field (AniList queries only use it as a filter arg,
    // never fetch it back), so read it defensively — defaults to false when absent.
    isAdult: !!(m as unknown as { isAdult?: boolean }).isAdult,
    startDate: m.startDate ?? undefined,
  }
}

/** Map one AnimeTorrent (+ its already-resolved infohash) to izumi's TorrentResult. Returns null
 *  when there is no valid 40-hex infohash — hash is load-bearing (Real-Debrid resolves it). */
export function atorrentToResult(t: AnimeTorrent, hash: string, upstreamRank?: number): TorrentResult | null {
  const h = (hash || '').toLowerCase()
  if (!/^[a-f0-9]{40}$/.test(h)) return null
  const episodeNumber = Number.isFinite(t.episodeNumber) && (t.episodeNumber ?? -1) >= 0
    ? Math.floor(t.episodeNumber as number)
    : undefined
  const evidence = {
    confirmedMatch: typeof t.confirmed === 'boolean' ? t.confirmed : undefined,
    bestRelease: typeof t.isBestRelease === 'boolean' ? t.isBestRelease : undefined,
    episodeNumber,
    resolution: t.resolution?.trim() || undefined,
    releaseGroup: t.releaseGroup?.trim() || undefined,
    publishedAt: t.date?.trim() || undefined,
    upstreamRank,
  }
  const hasEvidence = Object.values(evidence).some((value) => value !== undefined)
  return {
    title: t.name ?? 'Torrent',
    link: t.magnetLink || t.downloadUrl || t.link,
    hash: h,
    seeders: normalizeTorrentCount(t.seeders),
    leechers: normalizeTorrentCount(t.leechers),
    downloads: normalizeTorrentCount(t.downloadCount),
    size: t.size,
    // `isBatch` and `isBestRelease` are independent Seanime claims. The old fallback marked every
    // non-batch result as "best", manufacturing a strong signal the provider never made.
    ...(t.isBatch ? { type: 'batch' as const } : t.isBestRelease ? { type: 'best' as const } : {}),
    ...(t.confirmed ? { accuracy: 'high' as const } : {}),
    ...(hasEvidence ? { evidence } : {}),
  }
}

/** Query every anime-torrent-provider extension for an episode's torrents, mapped into izumi's
 *  TorrentResult. smartSearch when the provider supports it, else search. Best-effort: [] on any
 *  failure; dedupe by hash. `onBatch` fires with each provider's results as it settles. */
export async function queryTorrentProviders(query: TorrentQuery, media: SnMedia, onBatch?: (rs: TorrentResult[]) => void, onlyId?: string, signal?: AbortSignal): Promise<TorrentResult[]> {
  try {
    const trace = currentResolveTrace(query.anilistId, query.episode)
    const provs = await runningTorrentProviderExtensions(onlyId)
    if (!provs.length || signal?.aborted) return []
    traceResolve(trace, 'anime torrent providers ready', {
      queried: provs.map((provider) => provider.name),
    })
    // Release names are romaji-based; a localized display title may never appear in a torrent name,
    // so query by romaji. And when a precise episode/anime id is available the provider locates the
    // exact release by id — an extra title/resolution text filter then only over-restricts (an
    // id-pinned episode rarely carries the full title or a specific resolution in every release
    // name), so send an empty query and no resolution, and let the picker rank quality.
    const romaji = media.romajiTitle || query.titles[0] || ''
    const hasId = (query.anidbEid ?? 0) > 0 || (query.anidbAid ?? 0) > 0
    const per = await Promise.all(provs.map(async (p): Promise<TorrentResult[]> => {
      // A superseded resolve (source already picked) must not issue further worker queries — each
      // one spawns HTTP that competes with the picked source's playback path. Re-checked before
      // every dispatch tier, since getSettings/search can settle after the abort lands.
      if (signal?.aborted) return []
      if (!await p.ready || signal?.aborted) return []
      return extensionSourceScheduler.run(`torrent-provider:${p.id}`, async () => {
        const providerStartedAt = performance.now()
        traceResolve(trace, 'anime torrent provider start', { provider: p.name })
        try {
          const settingsStartedAt = performance.now()
          const s = (await p.call('getSettings').catch(() => null)) as AtpSettings | null
          traceResolve(trace, 'anime torrent provider settings ready', {
            provider: p.name,
            durationMs: Math.round(performance.now() - settingsStartedAt),
            smartSearch: !!s?.canSmartSearch,
          })
          if (signal?.aborted) return []
          const searchStartedAt = performance.now()
          const raw = (s?.canSmartSearch
            ? await p.call('smartSearch', { media, query: hasId ? '' : romaji, batch: false, episodeNumber: query.episode ?? -1, anidbAID: query.anidbAid, anidbEID: query.anidbEid, bestReleases: false })
            : await p.call('search', { media, query: romaji })) as unknown
          const list: AnimeTorrent[] = Array.isArray(raw) ? raw : []
          traceResolve(trace, 'anime torrent provider search finish', {
            provider: p.name,
            method: s?.canSmartSearch ? 'smartSearch' : 'search',
            durationMs: Math.round(performance.now() - searchStartedAt),
            rows: list.length,
          })
          const missingHashes = list.filter((torrent) => !torrent.infoHash).length
          if (missingHashes) traceResolve(trace, 'anime torrent hash lookups start', {
            provider: p.name, torrents: missingHashes,
          })
          // getTorrentInfoHash is one worker dispatch PER torrent. It used to run strictly serially,
          // so a 50-row result with no infoHash field was 50 back-to-back round-trips (each with a
          // 20s cap) before ANY row reached the picker. Run them through a small window instead —
          // wide enough to hide the per-dispatch latency, narrow enough not to stampede a provider
          // that resolves each hash with its own HTTP fetch. Order is preserved via the slot array.
          const HASH_LOOKUP_CONCURRENCY = 6
          const slots: (TorrentResult | undefined)[] = new Array(list.length)
          let next = 0
          const lookupWorker = async () => {
            while (next < list.length) {
              // A superseded resolve must not issue further worker queries; leave the rest unslotted.
              if (signal?.aborted) return
              const index = next++
              const t = list[index]
              let hash = (t.infoHash ?? '').toLowerCase()
              if (!hash) hash = (((await p.call('getTorrentInfoHash', t).catch(() => '')) as string) ?? '').toLowerCase()
              const r = atorrentToResult(t, hash, index)
              if (r) slots[index] = { ...r, provider: p.name, providerId: p.id, logo: p.icon }
            }
          }
          await Promise.all(Array.from({ length: Math.min(HASH_LOOKUP_CONCURRENCY, list.length) }, lookupWorker))
          if (signal?.aborted) return []
          const out: TorrentResult[] = slots.filter((r): r is TorrentResult => !!r)
          if (onBatch && out.length) onBatch(out)
          traceResolve(trace, 'anime torrent provider finish', {
            provider: p.name,
            durationMs: Math.round(performance.now() - providerStartedAt),
            rawRows: list.length,
            usableRows: out.length,
            hashLookups: missingHashes,
          })
          return out
        }
        catch (err) {
          // Silently degrade in release, but surface which provider threw during dev — a provider that
          // finds the anime then throws (e.g. on the torrent-fetch step) otherwise looks like an empty
          // result with no clue why. `import.meta.env.DEV` is compiled to `false` in release builds.
          if (import.meta.env.DEV) console.warn(`[torrent-provider: ${p.name}] threw during query`, err)
          traceResolveError(trace, 'anime torrent provider failed', err, {
            provider: p.name,
            durationMs: Math.round(performance.now() - providerStartedAt),
          })
          throw err
        }
      }).catch(() => [])
    }))
    const seen = new Set<string>()
    return per.flat().filter((r) => { if (seen.has(r.hash)) return false; seen.add(r.hash); return true })
  }
  catch (err) {
    if (import.meta.env.DEV) console.warn('[torrent-providers] query failed', err)
    return []
  }
}
