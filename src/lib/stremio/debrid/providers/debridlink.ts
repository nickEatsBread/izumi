import { jfetch, form, magnetOf, hashOf, pickLargestVideo, poll } from '../http'
import type { DebridProvider } from '../types'

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
      if ((t?.downloadPercent ?? 0) >= 100) return { stage: 'ready', progress: 100 }
      return { stage: (t?.downloadPercent ?? 0) > 0 ? 'downloading' : 'queued', progress: t?.downloadPercent }
    }, opts)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped = files.map((f: any) => ({ name: f.name ?? '', bytes: f.size ?? 0, downloadUrl: f.downloadUrl }))
    const best = pickLargestVideo(mapped)
    if (!best?.downloadUrl) throw new Error('No playable file in that torrent.')
    return best.downloadUrl
  },
}
