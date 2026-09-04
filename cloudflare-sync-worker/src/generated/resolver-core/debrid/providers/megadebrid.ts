// GENERATED from src/lib/stremio/debrid/providers/megadebrid.ts by scripts/generate-cloudflare-resolver-core.mjs.
// Edit the canonical source, then regenerate; do not edit this vendored copy.
import { jfetch, form, magnetOf, hashOf, poll, authError } from '../http'
import type { DebridProvider, DebridInfo } from '../types'

// Mega-Debrid (EXPERIMENTAL). Credential is USERNAME + PASSWORD (not an API key) —
// stored in the key field as "user:pass". connectUser exchanges it for a token, then
// the torrent section takes over: uploadTorrent (POST magnet) → getTorrent (POST hash)
// until the link appears → ub_link.
//
// Action names verified against the first-party docs (index.php?page=api) AND probed
// live on 2026-07-25: uploadMagnet and getTorrentStatus DO NOT EXIST — both answer
// {"response_code":"UNKNOWN_ACTION"}, which is what the previous implementation called.
// getTorrents (the real list action) carries no hash and no links, so the per-torrent
// getTorrent detail call is the only route to a playable URL.
//
// Premium-only: the docs state free accounts get "vip_end" back instead of a token.
// The torrent status vocabulary is NOT documented, hence the tolerant mdStatus parse —
// ub_link showing up is the signal we actually act on.

const BASE = 'https://www.mega-debrid.eu/api.php'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function md(action: string, params: Record<string, string>, body?: string, priority?: boolean): Promise<any> {
  const qs = new URLSearchParams({ action, ...params }).toString()
  const { ok, status, json } = await jfetch(`${BASE}?${qs}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, priority } : { priority })
  if (!ok) throw new Error(authError('Mega-Debrid', { status }, 'login') ?? `Mega-Debrid request failed (${status}).`)
  if (json?.response_code && json.response_code !== 'ok') throw new Error(authError('Mega-Debrid', { code: json?.response_code, message: json?.response_text }, 'login') ?? json?.response_text ?? 'Mega-Debrid request failed.')
  return json
}

export interface MdTorrent {
  name?: string
  nbFiles?: number
  size?: number
  status?: string
  progress?: number | string
  speed?: number | string
  peers?: number
  ub_link?: string
}

const num = (v: unknown): number | undefined => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** Pure map of a Mega-Debrid getTorrent payload to a DebridInfo. The status strings are
 *  undocumented (and the service is French, so "terminé" is as likely as "completed"),
 *  so readiness keys off ub_link — the field we need — and only the error vocabulary is
 *  matched by text. A torrent sitting at 100% without a link yet stays 'downloading' so
 *  the poll keeps waiting for the link to be generated. */
export function mdStatus(t: MdTorrent | undefined): DebridInfo {
  const raw = t?.status
  if (t?.ub_link) return { stage: 'ready', progress: 100, raw }
  if (/error|fail|dead|abort/i.test(raw ?? '')) return { stage: 'error', raw }
  const pct = num(t?.progress)
  return {
    stage: pct ? 'downloading' : 'queued',
    progress: pct,
    speed: num(t?.speed),
    seeders: t?.peers,
    total: num(t?.size),
    filename: t?.name,
    raw,
  }
}

export const megadebrid: DebridProvider = {
  id: 'megadebrid',
  name: 'Mega-Debrid',
  keyHint: 'mega-debrid.eu — enter as "username:password"',
  credential: 'userpass',
  cacheCheck: 'none',
  experimental: true,
  async resolveHash(cred, hashOrMagnet, opts) {
    // uploadTorrent creates an entry on the account, and there is no route back from a hash to an
    // entry the account already holds: getTorrents carries no hash and no links, and the by-hash
    // status action the docs imply does not exist (it answers UNKNOWN_ACTION). With no verified
    // way to reuse, a background prefetch can only decline — noAdd promises never to leave a
    // speculative torrent behind, and that promise outranks prefetching successfully.
    if (opts?.noAdd) throw new Error("Mega-Debrid needs to add this release, which background prefetch isn't allowed to do.")
    const [login, password] = (cred ?? '').split(':')
    if (!login || !password) throw new Error('Mega-Debrid needs "username:password" in the key field.')
    const token = (await md('connectUser', { login, password }, undefined, opts?.priority)).token
    if (!token) throw new Error('Mega-Debrid login failed.')
    // Documented free-account marker: the token slot carries "vip_end" instead of a token.
    if (token === 'vip_end') throw new Error('Mega-Debrid: access denied — this API is premium-only and your account looks free or expired.')
    const up = await md('uploadTorrent', { token }, form({ magnet: magnetOf(hashOrMagnet) }), opts?.priority)
    // uploadTorrent answers { newTorrent: { name, size, hash } } — that hash is the key
    // getTorrent wants. Fall back to the magnet's own btih if the field is missing.
    const hash = up?.newTorrent?.hash ?? hashOf(hashOrMagnet)
    let torrent: MdTorrent | undefined
    await poll(async () => {
      const r = await md('getTorrent', { token }, form({ hash }), opts?.priority)
      // The detail payload is nested under "status" (docs); tolerate a flat shape too.
      torrent = r && typeof r.status === 'object' ? r.status : r
      return mdStatus(torrent)
    }, opts)
    const link = torrent?.ub_link
    if (!link) throw new Error('No playable file in that torrent.')
    return link
  },
}
