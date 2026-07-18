import { jfetch, form, magnetOf, hashOf, pickLargestVideo, poll, VIDEO, JUNK, authError } from '../http'
import type { DebridProvider, DebridInfo, DebridItem, DebridFile } from '../types'

// Debrid-Link. Simplest torrent flow: add magnet → poll /seedbox/list until 100% →
// files[].downloadUrl is DIRECT (no select, no unlock). Envelope: { success, value }.

const BASE = 'https://debrid-link.fr/api/v2'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function dl(method: string, path: string, key: string, body?: string): Promise<any> {
  const { status, json } = await jfetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    ...(body ? { body } : {}),
  })
  if (json?.success === false) {
    const auth = authError('Debrid-Link', { status, code: json?.error })
    throw new Error(auth ?? json?.error ?? 'Debrid-Link request failed.')
  }
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

interface DlTorrent { id: string; name?: string; totalSize?: number; downloadPercent?: number; downloaded?: number; peersConnected?: number; hashString?: string; files?: Array<{ name?: string; size?: number; downloadUrl?: string }>; created?: number }

/** Pure map of a Debrid-Link seedbox item to a DebridItem. created is epoch SECONDS. */
export function dlListItem(t: DlTorrent): DebridItem {
  const info = dlStatus(t)
  return {
    id: t.id, name: t.name ?? '', size: t.totalSize ?? 0, hash: t.hashString?.toLowerCase(),
    status: info.stage, progress: info.progress,
    addedAt: t.created ? t.created * 1000 : undefined, fileCount: t.files?.length,
  }
}

/** Pure map of a Debrid-Link file to a DebridFile. downloadUrl is DIRECT → the file id. */
export function dlFile(f: { name?: string; size?: number; downloadUrl?: string }): DebridFile {
  const name = f.name ?? ''
  return { id: f.downloadUrl ?? '', name, size: f.size ?? 0, playable: VIDEO.test(name) && !JUNK.test(name) }
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
  async listItems(key) {
    if (!key) throw new Error('No Debrid-Link API key set — add it in Settings → Extensions.')
    const r = await dl('GET', '/seedbox/list', key)
    return (r.value ?? []).map(dlListItem)
  },
  async listFiles(key, item) {
    const r = await dl('GET', '/seedbox/list', key)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = (r.value ?? []).find((x: any) => x.id === item.id)
    return (t?.files ?? []).map(dlFile)
  },
  async resolveFile(_key, _item, file) {
    if (!file.id) throw new Error('No playable link for that file.')
    return file.id // downloadUrl is already direct.
  },
  async deleteItem(key, item) {
    await dl('DELETE', `/seedbox/${item.id}`, key)
  },
}
