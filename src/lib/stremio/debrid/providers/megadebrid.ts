import { jfetch, form, magnetOf, poll, authError } from '../http'
import type { DebridProvider } from '../types'

// Mega-Debrid (EXPERIMENTAL). Credential is USERNAME + PASSWORD (not an API key) —
// stored in the key field as "user:pass". We exchange it for a session token via
// connectUser, then use the torrent actions. Endpoint names from the Pyvonix client;
// the docs host was down during research — validate against a live account.

const BASE = 'https://www.mega-debrid.eu/api.php'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function md(action: string, params: Record<string, string>, body?: string): Promise<any> {
  const qs = new URLSearchParams({ action, ...params }).toString()
  const { ok, status, json } = await jfetch(`${BASE}?${qs}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body } : {})
  if (!ok) throw new Error(authError('Mega-Debrid', { status }, 'login') ?? `Mega-Debrid request failed (${status}).`)
  if (json?.response_code && json.response_code !== 'ok') throw new Error(authError('Mega-Debrid', { code: json?.response_code, message: json?.response_text }, 'login') ?? json?.response_text ?? 'Mega-Debrid request failed.')
  return json
}

export const megadebrid: DebridProvider = {
  id: 'megadebrid',
  name: 'Mega-Debrid',
  keyHint: 'mega-debrid.eu — enter as "username:password"',
  credential: 'userpass',
  experimental: true,
  async resolveHash(cred, hashOrMagnet, opts) {
    const [login, password] = (cred ?? '').split(':')
    if (!login || !password) throw new Error('Mega-Debrid needs "username:password" in the key field.')
    const token = (await md('connectUser', { login, password })).token
    if (!token) throw new Error('Mega-Debrid login failed.')
    await md('uploadMagnet', { token }, form({ magnet: magnetOf(hashOrMagnet) }))
    const want = magnetOf(hashOrMagnet)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let torrent: any
    await poll(async () => {
      const list = (await md('getTorrentStatus', { token })).torrents ?? []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      torrent = list.find((t: any) => (t.hash && want.includes(t.hash)) || t.name) ?? list[0]
      if (torrent?.status === 'complete') return { stage: 'ready', progress: 100, raw: torrent.status }
      if (torrent?.status === 'error') return { stage: 'error', raw: torrent.status }
      return { stage: 'downloading', progress: torrent?.progress, raw: torrent?.status }
    }, opts)
    const link = torrent?.downloadLink ?? torrent?.links?.[0]
    if (!link) throw new Error('No playable file in that torrent.')
    return link
  },
}
