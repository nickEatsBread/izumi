import type { TorrentResult } from '$lib/extensions/types'
import type { Stream } from './parse'

// Map an extension torrent result into our Stream shape. It carries only an
// infoHash (no url) — resolved through Real-Debrid on pick (playStream). The ⬇ in
// the name marks it uncached so describe() flags it and it never auto-plays.
export function extToStream(r: TorrentResult, extName: string): Stream {
  const gb = r.size ? `${(r.size / 1073741824).toFixed(2)} GB` : ''
  const prov = (extName.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase() || 'EXT')
  // 👤 only when the source reports a POSITIVE count. The old `${r.seeders ?? 0}` baked a
  // literal "👤 0" for sources that omit seeders OR hardcode 0 (seadex, tsuki) — and parse.ts
  // reads that back out of the title via /👤 (\d+)/, so "👤 0" round-tripped to cached='down'
  // and the row was hidden + unclickable. Emitting nothing for ≤0 makes it parse as unknown
  // → 'uncached' (clickable; let debrid try). Genuine live counts still show. `__seeders`
  // carries the raw value structurally for dedupe ranking — see dedupeStreams.
  const meta = [r.seeders ? `👤 ${r.seeders}` : '', gb ? `💾 ${gb}` : ''].filter(Boolean).join(' ')
  return {
    infoHash: r.hash,
    // Keep the full magnet (trackers included) when the result carried one, so debrid can find
    // peers for an uncached torrent instead of resolving a bare, trackerless hash.
    __magnet: r.link?.startsWith('magnet:') ? r.link : undefined,
    // Source-declared confidence: 'high' = id-verified by the source → refine trusts it.
    __accuracy: r.accuracy,
    // Raw count for the dedupe pass: lets a live-seeded copy of the same hash win over an
    // indexer that reports 0/unknown (the title string above is already baked by then).
    __seeders: r.seeders,
    name: `[${prov}⬇] ${extName}`,
    // The picker heading reads from __addonName, so the row shows which extension found it; __logo
    // supplies the extension's icon (and, being present, suppresses the redundant name on the right).
    __addonName: extName,
    __origin: r.providerId ? { kind: 'torrent-extension', id: r.providerId, name: extName } : undefined,
    __logo: r.logo,
    title: meta ? `${r.title}\n${meta}` : r.title,
    behaviorHints: { filename: r.title, videoSize: r.size },
  }
}
