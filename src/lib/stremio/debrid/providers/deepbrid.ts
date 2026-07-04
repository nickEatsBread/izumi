import { jfetch, form, magnetOf, poll } from '../http'
import type { DebridProvider } from '../types'

// Deepbrid (EXPERIMENTAL). Torrent endpoints are premium-gated; response shapes are
// from third-party clients, not a first-party spec — validate against a live premium
// key before trusting. Bearer auth.

const BASE = 'https://www.deepbrid.com/api/v1'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function db(method: string, path: string, key: string, body?: string): Promise<any> {
  const { ok, status, json } = await jfetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    ...(body ? { body } : {}),
  })
  if (!ok) throw new Error(`Deepbrid request failed (${status}).`)
  return json
}

export const deepbrid: DebridProvider = {
  id: 'deepbrid',
  name: 'Deepbrid',
  keyHint: 'deepbrid.com/api-docs',
  credential: 'apikey',
  experimental: true,
  async resolveHash(key, hashOrMagnet, opts) {
    if (!key) throw new Error('No Deepbrid API key set — add it in Settings → Extensions.')
    const add = await db('POST', '/torrents/add', key, form({ magnet: magnetOf(hashOrMagnet) }))
    const id = add.id ?? add.torrent?.id
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let torrent: any = add.torrent ?? add
    await poll(async () => {
      const r = await db('GET', `/torrents/info${id ? `?id=${id}` : ''}`, key)
      torrent = r.torrent ?? r
      if ((torrent?.progress ?? 0) >= 100) return { stage: 'ready', progress: 100 }
      return { stage: (torrent?.progress ?? 0) > 0 ? 'downloading' : 'queued', progress: torrent?.progress }
    }, opts)
    const link = torrent?.links?.[0] ?? torrent?.downloadLink
    if (!link) throw new Error('No playable file in that torrent.')
    return link
  },
}
