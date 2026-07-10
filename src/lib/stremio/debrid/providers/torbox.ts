import { jfetch, magnetOf, pickLargestVideo, poll } from '../http'
import type { DebridProvider, DebridInfo } from '../types'

// TorBox. Auto-selects; readiness via booleans; per-file link via requestdl (which
// takes the key as a QUERY param, unlike the Bearer-header calls). Envelope:
// { success, data, detail, error }.

const BASE = 'https://api.torbox.app/v1/api'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function tb(method: string, path: string, key: string, body?: FormData): Promise<any> {
  const { json } = await jfetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}` },
    ...(body ? { body } : {}),
  })
  if (json?.success === false) throw new Error(json?.detail ?? json?.error ?? 'TorBox request failed.')
  return json?.data
}

/** Pure map of a TorBox mylist entry to a DebridInfo. */
export function tbStatus(t: { download_finished?: boolean; download_present?: boolean; download_state?: string; active?: boolean; progress?: number; download_speed?: number; seeds?: number; size?: number }): DebridInfo {
  if (t.download_finished || t.download_present) return { stage: 'ready', progress: 100 }
  if (/error|dead/i.test(t.download_state ?? '')) return { stage: 'error', raw: t.download_state }
  return {
    stage: t.active ? 'downloading' : 'queued',
    progress: (t.progress ?? 0) * 100,
    speed: t.download_speed,
    seeders: t.seeds,
    total: t.size,
    raw: t.download_state,
  }
}

export const torbox: DebridProvider = {
  id: 'torbox',
  name: 'TorBox',
  keyHint: 'torbox.app/settings',
  credential: 'apikey',
  async resolveHash(key, hashOrMagnet, opts) {
    if (!key) throw new Error('No TorBox API key set — add it in Settings → Extensions.')
    const fd = new FormData(); fd.set('magnet', magnetOf(hashOrMagnet))
    const cr = await tb('POST', '/torrents/createtorrent', key, fd)
    const id = cr.torrent_id
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let files: any[] = []
    await poll(async () => {
      const r = await tb('GET', `/torrents/mylist?bypass_cache=true&id=${id}`, key)
      const t = Array.isArray(r) ? r[0] : r
      files = t?.files ?? []
      return tbStatus(t ?? {})
    }, opts)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped = files.map((f: any) => ({ name: f.short_name ?? f.name ?? '', bytes: f.size ?? 0, id: f.id }))
    const best = pickLargestVideo(mapped)
    if (best?.id == null) throw new Error('No playable file in that torrent.')
    // requestdl: token is a QUERY param here (not Bearer). data is the URL string.
    const dl = await tb('GET', `/torrents/requestdl?token=${encodeURIComponent(key)}&torrent_id=${id}&file_id=${best.id}`, key)
    if (typeof dl !== 'string') throw new Error('TorBox returned no link.')
    return dl
  },
}
