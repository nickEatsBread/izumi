import { get } from 'svelte/store'
import type { Media } from '$lib/anilist/types'
import { queryExtensions } from '$lib/extensions/manager'
import { queryTorrentProviders, toProviderMedia } from '$lib/extensions/torrentProvider'
import { queryTrackerFeeds } from '$lib/extensions/tracker-feeds'
import type { TorrentQuery, TorrentResult } from '$lib/extensions/types'
import { isAndroid } from '$lib/platform'
import { extToStream } from '$lib/stremio/ext-stream'
import type { Stream } from '$lib/stremio/parse'

/** One search box query over every release source the user added: tracker feeds and both torrent
 *  extension types. `onRows` gets the whole deduped list each time a source adds rows (one row per
 *  infohash; the copy with more seeders wins). Resolves once every source has settled. */
export async function searchReleases(text: string, onRows: (rows: Stream[]) => void, signal?: AbortSignal): Promise<Stream[]> {
  const query = text.trim()
  if (!query) return []
  const best = new Map<string, Stream>()
  const fold = (results: TorrentResult[]) => {
    if (signal?.aborted) return
    let changed = false
    for (const result of results) {
      const hash = result.hash?.toLowerCase()
      if (!hash) continue
      const stream = extToStream({ ...result, hash }, result.provider ?? 'Community source')
      const held = best.get(hash)
      if (held && (held.__seeders ?? -1) >= (stream.__seeders ?? -1)) continue
      best.set(hash, stream)
      changed = true
    }
    if (changed) onRows([...best.values()])
  }
  const torrentQuery: TorrentQuery = { titles: [query], isAndroid: get(isAndroid) }
  // No ids: providers fall back to searching the text itself.
  const providerMedia = toProviderMedia({ id: 0, title: { romaji: query, userPreferred: query } } as Media)
  await Promise.all([
    queryExtensions(torrentQuery, fold, undefined, signal),
    queryTorrentProviders(torrentQuery, providerMedia, fold, undefined, signal),
    queryTrackerFeeds(torrentQuery, fold, undefined, signal),
  ])
  return signal?.aborted ? [] : [...best.values()]
}
