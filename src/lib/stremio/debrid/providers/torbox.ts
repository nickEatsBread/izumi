import { jfetch, magnetOf, hashOf, poll, VIDEO, JUNK, authError, debridHttpError } from '../http'
import { pickVideoFile } from '../episode-file'
import type { DebridProvider, DebridInfo, DebridItem, DebridFile } from '../types'

// TorBox. Auto-selects; readiness via booleans; per-file link via requestdl (which
// takes the key as a QUERY param, unlike the Bearer-header calls). Envelope:
// { success, data, detail, error }.

const BASE = 'https://api.torbox.app/v1/api'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function tb(method: string, path: string, key: string, body?: FormData, priority?: boolean): Promise<any> {
  const { ok, status, json } = await jfetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}` },
    ...(body ? { body } : {}),
    priority,
  })
  if (json?.success === false) {
    const auth = authError('TorBox', { status, code: json?.error, message: json?.detail })
    throw new Error(auth ?? json?.detail ?? json?.error ?? 'TorBox request failed.')
  }
  // A transport failure (5xx, a gateway's HTML error page) carries no envelope at all, and jfetch
  // does not throw on a non-2xx — it hands back `{}`. tbStatus reads that as a queued torrent, so
  // an unchecked status let the poll loop sit on a dead service for its full ~10-minute deadline
  // with the "caching" overlay pinned. debridHttpError keeps the cases apart: a 5xx is ridden out
  // by poll, a 429 is ridden out on its own longer budget, a 401/404 ends the resolve now. Checked
  // AFTER the envelope so a 403 still
  // gets TorBox's own BAD_TOKEN wording rather than a bare status.
  if (!ok) throw debridHttpError(status, authError('TorBox', { status }) ?? `TorBox request failed (${status}).`)
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

/** Pure: the id of an already-ready mylist torrent for `hash`, or undefined. mylist answers with
 *  an array (whole list) or a bare object (single id), so accept both. Readiness is decided by
 *  tbStatus, the same mapping the poll loop uses — a still-downloading entry is not something a
 *  background prefetch can serve. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tbFindReady(list: any, hash: string): string | undefined {
  const arr = Array.isArray(list) ? list : (list ? [list] : [])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hit = arr.find((t: any) => (t?.hash ?? '').toLowerCase() === hash && tbStatus(t ?? {}).stage === 'ready')
  return hit ? String(hit.id) : undefined
}

/** Pure: TorBox checkcached `data` (format=object, keyed by hash) -> cache map.
 *  A hash we asked about that is ABSENT from a well-formed response is genuinely uncached —
 *  TorBox answered, it just said no. A malformed response yields an EMPTY map so every hash
 *  falls back to 'unknown' rather than being wrongly demoted. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tbCacheMap(data: any, asked: string[]): Map<string, 'cached' | 'uncached'> {
  const out = new Map<string, 'cached' | 'uncached'>()
  if (!data || typeof data !== 'object' || Array.isArray(data)) return out
  const hit = new Set(Object.keys(data).map((h) => h.toLowerCase()))
  for (const h of asked) {
    const k = h.toLowerCase()
    out.set(k, hit.has(k) ? 'cached' : 'uncached')
  }
  return out
}

export const torbox: DebridProvider = {
  id: 'torbox',
  name: 'TorBox',
  keyHint: 'torbox.app/settings',
  credential: 'apikey',
  cacheCheck: 'native',
  async resolveHash(key, hashOrMagnet, opts) {
    if (!key) throw new Error('No TorBox API key set — add it in Settings → Extensions.')
    let id: string | number
    if (opts?.noAdd) {
      // createtorrent adds a permanent entry to the account, so a background prefetch may only
      // reuse a torrent that is already there. mylist is TorBox's only by-hash lookup.
      const list = await tb('GET', '/torrents/mylist?bypass_cache=true', key, undefined, opts?.priority).catch(() => undefined)
      const existing = tbFindReady(list, hashOf(hashOrMagnet))
      if (!existing) throw new Error("TorBox needs to add this release, which background prefetch isn't allowed to do.")
      id = existing
    }
    else {
      const fd = new FormData(); fd.set('magnet', magnetOf(hashOrMagnet))
      const cr = await tb('POST', '/torrents/createtorrent', key, fd, opts?.priority)
      id = cr.torrent_id
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let files: any[] = []
    await poll(async () => {
      const r = await tb('GET', `/torrents/mylist?bypass_cache=true&id=${id}`, key, undefined, opts?.priority)
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
    const dl = await tb('GET', `/torrents/requestdl?token=${encodeURIComponent(key)}&torrent_id=${id}&file_id=${best.id}`, key, undefined, opts?.priority)
    if (typeof dl !== 'string') throw new Error('TorBox returned no link.')
    return dl
  },
  async checkCached(key, hashes) {
    if (!key || !hashes.length) return new Map()
    // POST with a JSON body: the GET variant takes repeatable ?hash= params and blows the URL
    // length limit on a full season of results. tb() only accepts FormData, so call jfetch
    // directly and keep tb()'s auth-classification behaviour inline.
    const { status, json } = await jfetch(
      `${BASE}/torrents/checkcached?format=object&list_files=false`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ hashes: hashes.map((h) => h.toLowerCase()) }),
      },
    )
    if (json?.success === false) {
      // Surface an expired key the same way the rest of the app does, but DO NOT throw:
      // a cache badge is a nicety and must not break the picker.
      const auth = authError('TorBox', { status, code: json?.error, message: json?.detail })
      if (auth) console.warn(auth)
      return new Map()
    }
    return tbCacheMap(json?.data, hashes)
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
