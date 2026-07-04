import { jfetch, form, magnetOf, pickLargestVideo, poll } from '../http'
import type { DebridProvider } from '../types'

// Offcloud. key query param. add /cloud → poll /cloud/status until 'downloaded' →
// /cloud/explore/{id} returns direct CDN URLs (single-file torrents expose the link
// in the add response). Requires the "cloud downloading" add-on on the account.

const BASE = 'https://offcloud.com/api'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function oc(method: string, path: string, key: string, body?: string): Promise<any> {
  const sep = path.includes('?') ? '&' : '?'
  const { json } = await jfetch(`${BASE}${path}${sep}key=${encodeURIComponent(key)}`, {
    method,
    ...(body ? { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body } : {}),
  })
  return json
}

export const offcloud: DebridProvider = {
  id: 'offcloud',
  name: 'Offcloud',
  keyHint: 'offcloud.com/#/account',
  credential: 'apikey',
  async resolveHash(key, hashOrMagnet, opts) {
    if (!key) throw new Error('No Offcloud API key set — add it in Settings → Extensions.')
    const add = await oc('POST', '/cloud', key, form({ url: magnetOf(hashOrMagnet) }))
    if (add.status === 'error' || !add.requestId) throw new Error(add.error ?? 'Offcloud rejected the magnet (cloud add-on required?).')
    const rid = add.requestId
    await poll(async () => {
      const st = await oc('POST', '/cloud/status', key, form({ requestId: rid }))
      const s = st.status?.status ?? st.status
      if (s === 'downloaded') return { stage: 'ready', progress: 100, raw: s }
      if (s === 'error') return { stage: 'error', raw: s }
      return { stage: s === 'created' ? 'queued' : 'downloading', raw: s }
    }, opts)
    let urls: string[] = []
    try { const ex = await oc('GET', `/cloud/explore/${rid}`, key); if (Array.isArray(ex)) urls = ex } catch { /* single-file */ }
    if (!urls.length && add.url) urls = [add.url]
    const mapped = urls.map((u) => ({ name: decodeURIComponent(u.split('/').pop() ?? ''), bytes: 0, url: u }))
    const best = pickLargestVideo(mapped) ?? mapped[0]
    if (!best?.url) throw new Error('No playable file in that torrent.')
    return best.url
  },
}
