import { fetch as httpFetch } from '@tauri-apps/plugin-http'

export interface Stream { url?: string; name?: string; title?: string; infoHash?: string; behaviorHints?: Record<string, unknown> }
export const streamId = (kitsuId: number, episode?: number) => episode != null ? `kitsu:${kitsuId}:${episode}` : `kitsu:${kitsuId}`
const RES = (s: Stream) => { const t = `${s.name ?? ''} ${s.title ?? ''}`.toLowerCase()
  return /2160|4k|uhd/.test(t) ? 2160 : /1080/.test(t) ? 1080 : /720/.test(t) ? 720 : /480/.test(t) ? 480 : 0 }
export function rankStreams(streams: Stream[]): Stream[] {
  return [...streams].sort((a, b) => RES(b) - RES(a))
}
// Query all configured addons for an episode; keep only debrid-resolved (url present).
// Uses the Tauri HTTP plugin (Rust reqwest) so requests bypass the webview's CORS +
// mixed-content restrictions and follow http->https redirects.
export async function getStreams(bases: string[], id: string, type = 'series'): Promise<Stream[]> {
  const results = await Promise.all(bases.map(async base => {
    const b = base.replace(/^http:\/\//i, 'https://')
    try {
      const r = await httpFetch(`${b}/stream/${type}/${encodeURIComponent(id)}.json`)
      if (!r.ok) return []
      const j = await r.json() as { streams?: Stream[] }
      return j.streams ?? []
    } catch { return [] }
  }))
  const all = results.flat().filter(s => !!s.url)   // debrid only
  return rankStreams(all)
}
