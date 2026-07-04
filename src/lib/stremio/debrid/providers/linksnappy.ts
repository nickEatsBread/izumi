import { jfetch, hashOf, poll } from '../http'
import type { DebridProvider } from '../types'

// LinkSnappy (EXPERIMENTAL). Torrent API is secondary to its hoster core and the
// endpoint names come from JDownloader/ResolveURL plugins, not a first-party spec —
// validate against a live key. apiKey query param, UPPERCASE actions.

const BASE = 'https://linksnappy.com/api'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ls(path: string, key: string): Promise<any> {
  const sep = path.includes('?') ? '&' : '?'
  const { ok, status, json } = await jfetch(`${BASE}${path}${sep}apiKey=${encodeURIComponent(key)}`)
  if (!ok) throw new Error(`LinkSnappy request failed (${status}).`)
  if (json?.status === 'ERROR') throw new Error(json?.error ?? 'LinkSnappy request failed.')
  return json?.return ?? json
}

export const linksnappy: DebridProvider = {
  id: 'linksnappy',
  name: 'LinkSnappy',
  keyHint: 'linksnappy.com/api',
  credential: 'apikey',
  experimental: true,
  async resolveHash(key, hashOrMagnet, opts) {
    if (!key) throw new Error('No LinkSnappy API key set — add it in Settings → Extensions.')
    const hash = hashOf(hashOrMagnet)
    const add = await ls(`/torrents/ADDMAGNET?hash=${encodeURIComponent(hash)}`, key)
    const id = add.id ?? add.torrentId
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let torrent: any = add
    await poll(async () => {
      const r = await ls(`/torrents/STATUS?id=${id}`, key)
      torrent = Array.isArray(r) ? r[0] : (r.torrent ?? r)
      if (torrent?.status === 'completed' || (torrent?.percentDone ?? 0) >= 100) return { stage: 'ready', progress: 100 }
      return { stage: (torrent?.percentDone ?? 0) > 0 ? 'downloading' : 'queued', progress: torrent?.percentDone }
    }, opts)
    const fid = torrent?.files?.[0]?.id ?? torrent?.fid
    const links = await ls(`/torrents/DOWNLOADLINKS?fid=${fid}&id=${id}`, key)
    const link = Array.isArray(links) ? links[0]?.link ?? links[0] : links?.link
    if (!link) throw new Error('No playable file in that torrent.')
    return link
  },
}
