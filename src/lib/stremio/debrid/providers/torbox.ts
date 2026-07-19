import { jfetch, magnetOf, poll, VIDEO, JUNK, authError } from '../http'
import { pickVideoFile } from '../episode-file'
import type { DebridProvider, DebridInfo, DebridItem, DebridFile } from '../types'

// TorBox. Auto-selects; readiness via booleans; per-file link via requestdl (which
// takes the key as a QUERY param, unlike the Bearer-header calls). Envelope:
// { success, data, detail, error }.

const BASE = 'https://api.torbox.app/v1/api'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function tb(method: string, path: string, key: string, body?: FormData): Promise<any> {
  const { status, json } = await jfetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}` },
    ...(body ? { body } : {}),
  })
  if (json?.success === false) {
    const auth = authError('TorBox', { status, code: json?.error, message: json?.detail })
    throw new Error(auth ?? json?.detail ?? json?.error ?? 'TorBox request failed.')
  }
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

interface TbTorrent { id: number | string; name?: string; hash?: string; size?: number; files?: Array<{ id: number; short_name?: string; name?: string; size?: number }>; download_finished?: boolean; download_present?: boolean; active?: boolean; progress?: number; download_speed?: number; seeds?: number; download_state?: string; created_at?: string }

/** Pure map of a TorBox mylist torrent to a DebridItem. */
export function tbListItem(t: TbTorrent): DebridItem {
  const info = tbStatus(t)
  return {
    id: String(t.id), name: t.name ?? '', size: t.size ?? 0, hash: t.hash?.toLowerCase(),
    status: info.stage, progress: info.progress,
    addedAt: t.created_at ? (Date.parse(t.created_at) || undefined) : undefined,
    fileCount: t.files?.length,
  }
}

/** Pure map of a TorBox file to a DebridFile. */
export function tbFile(f: { id: number; short_name?: string; name?: string; size?: number }): DebridFile {
  const name = f.short_name ?? f.name ?? ''
  return { id: String(f.id), name, size: f.size ?? 0, playable: VIDEO.test(name) && !JUNK.test(name) }
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
    // Prefer the fuller `name` (may carry a Season-N folder path the episode matcher can
    // read); short_name is the bare filename fallback.
    const mapped = files.map((f: any) => ({ name: f.name ?? f.short_name ?? '', bytes: f.size ?? 0, id: f.id }))
    const best = pickVideoFile(mapped, opts?.want)
    if (best?.id == null) throw new Error('No playable file in that torrent.')
    // requestdl: token is a QUERY param here (not Bearer). data is the URL string.
    const dl = await tb('GET', `/torrents/requestdl?token=${encodeURIComponent(key)}&torrent_id=${id}&file_id=${best.id}`, key)
    if (typeof dl !== 'string') throw new Error('TorBox returned no link.')
    return dl
  },
  async listItems(key) {
    if (!key) throw new Error('No TorBox API key set — add it in Settings → Extensions.')
    const r = await tb('GET', '/torrents/mylist?bypass_cache=true', key)
    const arr = Array.isArray(r) ? r : (r ? [r] : [])
    return arr.map(tbListItem)
  },
  async listFiles(key, item) {
    const r = await tb('GET', `/torrents/mylist?bypass_cache=true&id=${item.id}`, key)
    const t = Array.isArray(r) ? r[0] : r
    return (t?.files ?? []).map(tbFile)
  },
  async resolveFile(key, item, file) {
    const dl = await tb('GET', `/torrents/requestdl?token=${encodeURIComponent(key)}&torrent_id=${item.id}&file_id=${file.id}`, key)
    if (typeof dl !== 'string') throw new Error('TorBox returned no link for that file.')
    return dl
  },
  async deleteItem(key, item) {
    const { json } = await jfetch(`${BASE}/torrents/controltorrent`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ torrent_id: Number(item.id), operation: 'delete' }),
    })
    if (json?.success === false) throw new Error(json?.detail ?? 'TorBox delete failed.')
  },
}
