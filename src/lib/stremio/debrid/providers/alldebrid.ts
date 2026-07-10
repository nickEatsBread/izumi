import { jfetch, form, magnetOf, pickLargestVideo, poll } from '../http'
import type { DebridProvider, DebridInfo } from '../types'

// AllDebrid. Auto-selects files; ready = statusCode===4; the file link MUST be
// unlocked. Envelope: { status:'success'|'error', data, error }.

const BASE = 'https://api.alldebrid.com'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ad(path: string, key: string, body: string): Promise<any> {
  const { json } = await jfetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (json?.status !== 'success') throw new Error(json?.error?.message ?? 'AllDebrid request failed.')
  return json.data
}

/** Pure map of an AllDebrid magnet/status entry to a DebridInfo. */
export function adStatus(s: { statusCode: number; status: string; downloaded?: number; size?: number; seeders?: number; downloadSpeed?: number }): DebridInfo {
  if (s.statusCode === 4) return { stage: 'ready', progress: 100, raw: s.status }
  if (s.statusCode >= 5) return { stage: 'error', raw: s.status }
  const progress = s.size ? Math.min(100, ((s.downloaded ?? 0) / s.size) * 100) : undefined
  return {
    stage: s.statusCode >= 1 ? 'downloading' : 'queued',
    progress,
    seeders: s.seeders,
    speed: s.downloadSpeed,
    downloaded: s.downloaded,
    total: s.size,
    raw: s.status,
  }
}

export const alldebrid: DebridProvider = {
  id: 'alldebrid',
  name: 'AllDebrid',
  keyHint: 'alldebrid.com/apikeys',
  credential: 'apikey',
  async resolveHash(key, hashOrMagnet, opts) {
    if (!key) throw new Error('No AllDebrid API key set — add it in Settings → Extensions.')
    const up = await ad('/v4/magnet/upload', key, form({ 'magnets[]': magnetOf(hashOrMagnet) }))
    const m = up.magnets?.[0]
    if (m?.error) throw new Error(m.error.message ?? 'AllDebrid rejected the magnet.')
    const id = String(m.id)
    await poll(async () => {
      const st = (await ad('/v4.1/magnet/status', key, form({ id }))).magnets
      const s = Array.isArray(st) ? st[0] : st
      return adStatus(s)
    }, opts)
    const tree = (await ad('/v4/magnet/files', key, form({ 'id[]': id })))?.magnets?.[0]?.files ?? []
    const flat: { name: string; bytes: number; link: string }[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(function walk(ns: any[]) { for (const n of ns) { if (n.e) walk(n.e); else flat.push({ name: n.n, bytes: n.s ?? 0, link: n.l }) } })(tree)
    const best = pickLargestVideo(flat)
    if (!best?.link) throw new Error('No playable file in that torrent.')
    const unlocked = await ad('/v4/link/unlock', key, form({ link: best.link }))
    return unlocked.link ?? unlocked.download
  },
}
