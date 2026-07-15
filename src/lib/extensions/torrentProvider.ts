import type { Media } from '$lib/anilist/types'
import type { TorrentResult, TorrentQuery } from './types'
import { runningTorrentProviderExtensions } from './manager'

// anime-torrent-provider SDK shapes. Fields we consume.
export interface SnMedia {
  id: number; idMal?: number; status: string; format: string
  englishTitle?: string; romajiTitle: string; episodeCount: number
  synonyms: string[]; isAdult: boolean; startDate?: { year?: number; month?: number; day?: number }
}
export interface AnimeTorrent {
  name?: string; size?: number; seeders?: number; leechers?: number; downloadCount?: number
  link?: string; downloadUrl?: string; magnetLink?: string; infoHash?: string
  resolution?: string; isBatch?: boolean; episodeNumber?: number
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
export function atorrentToResult(t: AnimeTorrent, hash: string): TorrentResult | null {
  const h = (hash || '').toLowerCase()
  if (!/^[a-f0-9]{40}$/.test(h)) return null
  return {
    title: t.name ?? 'Torrent',
    link: t.magnetLink || t.downloadUrl || t.link,
    hash: h,
    seeders: t.seeders,
    leechers: t.leechers,
    downloads: t.downloadCount,
    size: t.size,
    type: t.isBatch ? 'batch' : 'best',
  }
}

/** Query every anime-torrent-provider extension for an episode's torrents, mapped into izumi's
 *  TorrentResult. smartSearch when the provider supports it, else search. Best-effort: [] on any
 *  failure; dedupe by hash. */
export async function queryTorrentProviders(query: TorrentQuery, media: SnMedia): Promise<TorrentResult[]> {
  try {
    const provs = await runningTorrentProviderExtensions()
    if (!provs.length) return []
    // Release names are romaji-based; a localized display title may never appear in a torrent name,
    // so query by romaji. And when a precise episode/anime id is available the provider locates the
    // exact release by id — an extra title/resolution text filter then only over-restricts (an
    // id-pinned episode rarely carries the full title or a specific resolution in every release
    // name), so send an empty query and no resolution, and let the picker rank quality.
    const romaji = media.romajiTitle || query.titles[0] || ''
    const hasId = (query.anidbEid ?? 0) > 0 || (query.anidbAid ?? 0) > 0
    const per = await Promise.all(provs.map(async (p): Promise<TorrentResult[]> => {
      try {
        const s = (await p.call('getSettings').catch(() => null)) as AtpSettings | null
        const raw = (s?.canSmartSearch
          ? await p.call('smartSearch', { media, query: hasId ? '' : romaji, batch: false, episodeNumber: query.episode ?? -1, anidbAID: query.anidbAid, anidbEID: query.anidbEid, bestReleases: false })
          : await p.call('search', { media, query: romaji })) as unknown
        const list: AnimeTorrent[] = Array.isArray(raw) ? raw : []
        const out: TorrentResult[] = []
        for (const t of list) {
          let hash = (t.infoHash ?? '').toLowerCase()
          if (!hash) hash = (((await p.call('getTorrentInfoHash', t).catch(() => '')) as string) ?? '').toLowerCase()
          const r = atorrentToResult(t, hash)
          if (r) out.push({ ...r, provider: p.name, logo: p.icon })
        }
        return out
      }
      catch (err) {
        // Silently degrade in release, but surface which provider threw during dev — a provider that
        // finds the anime then throws (e.g. on the torrent-fetch step) otherwise looks like an empty
        // result with no clue why. `import.meta.env.DEV` is compiled to `false` in release builds.
        if (import.meta.env.DEV) console.warn(`[torrent-provider: ${p.name}] threw during query`, err)
        return []
      }
    }))
    const seen = new Set<string>()
    return per.flat().filter((r) => { if (seen.has(r.hash)) return false; seen.add(r.hash); return true })
  }
  catch (err) {
    if (import.meta.env.DEV) console.warn('[torrent-providers] query failed', err)
    return []
  }
}
