import type { Stream } from './parse'

const isTorrentExt = (s: Stream) => s.__origin?.kind === 'torrent-extension'

/** Dedupe `streams` by `keyFn(s)`, keeping the FIRST row per key — except that among
 *  torrent-extension duplicates the copy with the highest KNOWN seeder count wins. Indexers
 *  disagree about the same torrent (one reports live seeders, another returns 0/unknown for the
 *  identical infoHash), and plain first-wins let the 0-copy shadow the live one — dropping the
 *  real seeder count and painting a well-seeded release as dead. Rows with a falsy key, and addon
 *  rows (which may carry a resolved/cached url), are never displaced. Order is preserved: a
 *  replacement sits at the first occurrence's position. */
export function dedupeBy(streams: Stream[], keyFn: (s: Stream) => string): Stream[] {
  const at = new Map<string, number>()
  const out: Stream[] = []
  for (const s of streams) {
    const k = keyFn(s)
    if (!k) { out.push(s); continue }
    const i = at.get(k)
    if (i == null) { at.set(k, out.length); out.push(s); continue }
    const kept = out[i]
    if (isTorrentExt(kept) && isTorrentExt(s) && (s.__seeders ?? -1) > (kept.__seeders ?? -1)) out[i] = s
  }
  return out
}

// Drop exact duplicates across addons: the same torrent/file is often returned by
// several addons as an identical resolve URL (or infoHash) — e.g. Torrentio AND Comet
// both surface the same S00 special. A duplicate resolve URL would also crash the
// picker's keyed {#each} (Svelte each_key_duplicate), so this is correctness, not just
// tidiness. Keyed by resolved url first (collapseBatches only dedupes by infoHash, and
// resolve-URL rows often carry no infoHash field).
export function dedupeStreams(streams: Stream[]): Stream[] {
  return dedupeBy(streams, (s) => s.url ?? s.infoHash ?? s.behaviorHints?.filename ?? s.name ?? '')
}
