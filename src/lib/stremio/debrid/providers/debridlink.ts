import { jfetch, form, magnetOf, hashOf, pickLargestVideo, poll } from '../http'
import type { DebridProvider, DebridInfo } from '../types'

// Debrid-Link. Simplest torrent flow: add magnet → poll /seedbox/list until 100% →
// files[].downloadUrl is DIRECT (no select, no unlock). Envelope: { success, value }.

const BASE = 'https://debrid-link.fr/api/v2'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function dl(method: string, path: string, key: string, body?: string): Promise<any> {
  const { json } = await jfetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    ...(body ? { body } : {}),
  })
  if (json?.success === false) throw new Error(json?.error ?? 'Debrid-Link request failed.')
  return json
}

/** Pure map of a Debrid-Link seedbox entry to a DebridInfo. `peersConnected` is the
 *  closest DL exposes to a seeder count; fields absent on some accounts stay undefined. */
export function dlStatus(t: { downloadPercent?: number; totalSize?: number; downloaded?: number; peersConnected?: number } | undefined): DebridInfo {
  const pct = t?.downloadPercent ?? 0
  if (pct >= 100) return { stage: 'ready', progress: 100 }
  return {
    stage: pct > 0 ? 'downloading' : 'queued',
    progress: t?.downloadPercent,
    total: t?.totalSize,
    downloaded: t?.downloaded,
    seeders: t?.peersConnected,
  }
}

export const debridlink: DebridProvider = {
  id: 'debridlink',
  name: 'Debrid-Link',
  keyHint: 'debrid-link.com/webapp/apikey',
  credential: 'apikey',
  async resolveHash(key, hashOrMagnet, opts) {
    if (!key) throw new Error('No Debrid-Link API key set — add it in Settings → Extensions.')
    const add = await dl('POST', '/seedbox/add', key, form({ url: magnetOf(hashOrMagnet) }))
    const addedId = add.value?.id
    const want = hashOf(hashOrMagnet)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let files: any[] = []
    await poll(async () => {
      const list = (await dl('GET', '/seedbox/list', key)).value ?? []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = list.find((x: any) => (x.hashString ?? '').toLowerCase() === want) ?? list.find((x: any) => x.id === addedId)
      files = t?.files ?? []
      return dlStatus(t)
    }, opts)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped = files.map((f: any) => ({ name: f.name ?? '', bytes: f.size ?? 0, downloadUrl: f.downloadUrl }))
    const best = pickLargestVideo(mapped)
    if (!best?.downloadUrl) throw new Error('No playable file in that torrent.')
    return best.downloadUrl
  },
}
