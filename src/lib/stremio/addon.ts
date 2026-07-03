import { fetch as httpFetch } from '@tauri-apps/plugin-http'

export interface Stream { url?: string; name?: string; title?: string; infoHash?: string; behaviorHints?: Record<string, unknown> }
export const streamId = (kitsuId: number, episode?: number) => episode != null ? `kitsu:${kitsuId}:${episode}` : `kitsu:${kitsuId}`
const RES = (s: Stream) => { const t = `${s.name ?? ''} ${s.title ?? ''}`.toLowerCase()
  return /2160|4k|uhd/.test(t) ? 2160 : /1080/.test(t) ? 1080 : /720/.test(t) ? 720 : /480/.test(t) ? 480 : 0 }
export function rankStreams(streams: Stream[]): Stream[] {
  return [...streams].sort((a, b) => RES(b) - RES(a))
}

// Human-facing metadata for the source picker, parsed from Torrentio's name/title
// (name e.g. "[RD+] Torrentio\n1080p"; title e.g. "Release 1080p WEB\n👤 120 💾 1.4 GB").
export interface StreamInfo {
  stream: Stream
  quality: number
  label: string
  seeders?: number
  size?: string
  provider?: string
}
export function describe(s: Stream): StreamInfo {
  const title = s.title ?? ''
  const name = s.name ?? ''
  const q = RES(s)
  const seeders = title.match(/👤\s*(\d+)/)?.[1]
  const size = title.match(/💾\s*([\d.]+\s*[kmgt]?i?b)/i)?.[1]
  const provider = name.match(/\[([A-Za-z]{2,3})\+?\]/)?.[1]?.toUpperCase()
  // Prefer the release/filename line for the label; fall back to the addon name.
  const label = (title.split('\n')[0] || name.split('\n')[0] || 'Stream').trim()
  return { stream: s, quality: q, label, seeders: seeders ? Number(seeders) : undefined, size: size?.replace(/\s+/g, ' ').trim(), provider }
}
export const qualityLabel = (q: number) => (q >= 2160 ? '4K' : q ? `${q}p` : 'SD')

// Auto-select the best source for a preferred quality ('2160'|'1080'|'720'|'480'|
// 'any'). `streams` are already ranked by resolution desc. Prefer an exact quality
// match, else the highest at-or-below the target, else the highest available.
export function pickBest(streams: Stream[], quality: string): Stream | undefined {
  if (!streams.length) return undefined
  if (quality === 'any') return streams[0]
  const target = Number(quality)
  const exact = streams.find((s) => RES(s) === target)
  if (exact) return exact
  const atOrBelow = streams.filter((s) => RES(s) <= target)
  return atOrBelow[0] ?? streams[0]
}
// A Torrentio+debrid stream is only instantly playable if the debrid service has
// it CACHED. Uncached torrents come back marked "[RD download]" / "[AD download]"
// / "[PM download]" and, if opened, drop the user into a "downloading to debrid"
// placeholder instead of the video. We must never play those — detect them by the
// "download"/"downloading" marker and drop them, keeping only cached (resolved)
// streams. Cached ones are marked "[RD+]" etc. (no "download" word).
const isUncached = (s: Stream) => /\bdownloading?\b/i.test(`${s.name ?? ''} ${s.title ?? ''}`)

// Query all configured addons for an episode; keep only CACHED debrid streams
// (resolved `.url` present AND not a download-to-debrid placeholder).
// Uses the Tauri HTTP plugin (Rust reqwest) so requests bypass the webview's CORS +
// mixed-content restrictions and follow http->https redirects.
// Returns the cached-playable streams plus the TOTAL stream count, so callers can
// distinguish "no torrents at all" from "torrents found but none cached".
export async function getStreams(bases: string[], id: string, type = 'series'): Promise<{ playable: Stream[]; total: number }> {
  const results = await Promise.all(bases.map(async base => {
    // Ensure an absolute https base (existing saved URLs may be http or scheme-less).
    let b = base.replace(/^http:\/\//i, 'https://')
    if (!/^https?:\/\//i.test(b)) b = 'https://' + b
    try {
      const r = await httpFetch(`${b}/stream/${type}/${encodeURIComponent(id)}.json`)
      if (!r.ok) return []
      const j = await r.json() as { streams?: Stream[] }
      return j.streams ?? []
    } catch { return [] }
  }))
  const all = results.flat()
  const cached = all.filter(s => !!s.url && !isUncached(s))
  return { playable: rankStreams(cached), total: all.length }
}
