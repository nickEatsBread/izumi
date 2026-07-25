import { jfetch, form, magnetOf, poll, authError } from '../http'
import type { DebridProvider, DebridInfo } from '../types'

// Deepbrid (EXPERIMENTAL). Bearer key; the torrent endpoints are premium-gated.
// Verified against the first-party docs (deepbrid.com/api-docs) + live probes on
// 2026-07-25:
//   • Failures come back as HTTP **200** with {error:<code>, message} — e.g.
//     {"error":2,"message":"You aren't a premium user"}. The old !ok check let that
//     straight through, so a free/blocked account polled a garbage object until the
//     10-minute timeout instead of saying why. A non-zero `error` is now a throw.
//   • GET /torrents/info?id=N → {error,id,filename,progress,seeders,speed,links[]}.
//   • GET /torrents/info with NO id → an ORDINAL-keyed map, {"1":{…},"2":{…}} — not a
//     torrent, which is what `r.torrent ?? r` used to hand to the progress read.
// The links are deepbrid.com/mytorrents?… pages rather than direct file URLs, so we run
// the pick through the documented unrestricter and fall back to the raw link.

const BASE = 'https://www.deepbrid.com/api/v1'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function db(method: string, path: string, key: string, body?: string): Promise<any> {
  const { ok, status, json } = await jfetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    ...(body ? { body } : {}),
  })
  if (!ok) throw new Error(authError('Deepbrid', { status }) ?? `Deepbrid request failed (${status}).`)
  // `error` is 0 on success. Newer responses use the HTTP status as the code (401/403),
  // older ones a small ordinal (2 = not premium) — feed whichever is meaningful to the
  // classifier and always keep the human message.
  const code = Number(json?.error)
  if (code) {
    const sig = { status: code >= 400 ? code : status, message: json?.message as string | undefined }
    throw new Error(authError('Deepbrid', sig) ?? json?.message ?? `Deepbrid request failed (error ${json.error}).`)
  }
  return json
}

export interface DbTorrent {
  id?: string | number
  filename?: string
  progress?: number | string
  seeders?: number
  speed?: number | string // "0.00 MB/s"
  links?: string[]
}

const isTorrent = (v: unknown): v is DbTorrent =>
  !!v && typeof v === 'object' && ['filename', 'progress', 'links', 'id'].some((k) => k in (v as object))

/** Pick one torrent out of a /torrents/info response. With an `id` the response IS the
 *  torrent; without one it is an ordinal-keyed map ({"1":{…},"2":{…}}), so we match on
 *  the wanted id — or, when the add call gave us none, take the highest id, which is the
 *  one we just created (Deepbrid ids ascend). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dbPick(json: any, id?: string): DbTorrent | undefined {
  if (!json || typeof json !== 'object') return undefined
  if (isTorrent(json.torrent)) return json.torrent
  const entries = Object.values(json).filter(isTorrent)
  // Single-torrent shape: the payload itself carries the fields (and no nested entries).
  if (!entries.length) return isTorrent(json) ? json : undefined
  if (id) return entries.find((t) => String(t.id) === String(id))
  return entries.sort((a, b) => Number(b.id ?? 0) - Number(a.id ?? 0))[0]
}

const UNIT: Record<string, number> = { '': 1, k: 1e3, m: 1e6, g: 1e9 }

/** "12.50 MB/s" → bytes/sec. Undefined when the field is absent or unparseable. */
export function dbSpeed(v: number | string | undefined): number | undefined {
  if (typeof v === 'number') return v > 0 ? v : undefined
  const m = /([\d.]+)\s*(k|m|g)?b\/s/i.exec(v ?? '')
  if (!m) return undefined
  const n = Number(m[1]) * (UNIT[(m[2] ?? '').toLowerCase()] ?? 1)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** Pure map of a Deepbrid torrent entry to a DebridInfo. */
export function dbStatus(t: DbTorrent | undefined): DebridInfo {
  const pct = Number(t?.progress ?? 0) || 0
  if (pct >= 100) return { stage: 'ready', progress: 100 }
  return {
    stage: pct > 0 ? 'downloading' : 'queued',
    progress: pct || undefined,
    seeders: t?.seeders,
    speed: dbSpeed(t?.speed),
    filename: t?.filename,
  }
}

export const deepbrid: DebridProvider = {
  id: 'deepbrid',
  name: 'Deepbrid',
  keyHint: 'deepbrid.com/api-docs',
  credential: 'apikey',
  cacheCheck: 'none',
  experimental: true,
  async resolveHash(key, hashOrMagnet, opts) {
    if (!key) throw new Error('No Deepbrid API key set — add it in Settings → Extensions.')
    // /torrents/add creates an entry on the account and Deepbrid exposes no verified by-hash
    // listing to reuse one from, so a background prefetch can only decline. Bailing is the whole
    // point of noAdd: never a speculative entry the user didn't ask for.
    if (opts?.noAdd) throw new Error("Deepbrid needs to add this release, which background prefetch isn't allowed to do.")
    const add = await db('POST', '/torrents/add', key, form({ magnet: magnetOf(hashOrMagnet) }))
    const id = add?.id ?? add?.torrent?.id ?? add?.torrentId
    let torrent: DbTorrent | undefined
    await poll(async () => {
      const r = await db('GET', `/torrents/info${id ? `?id=${encodeURIComponent(String(id))}` : ''}`, key)
      torrent = dbPick(r, id ? String(id) : undefined)
      return dbStatus(torrent)
    }, opts)
    const link = torrent?.links?.[0]
    if (!link) throw new Error('No playable file in that torrent.')
    // /torrents/info hands back mytorrents?… pages, not direct file URLs; /generate/link
    // is the documented way to turn one into a premium-dl URL. It can legitimately refuse
    // (a live probe answers error 16 "Wrong captcha entered" for anonymous callers), so a
    // failure here falls back to the raw link rather than killing playback.
    try {
      const gen = await db('POST', '/generate/link', key, form({ link }))
      if (gen?.link) return gen.link
    } catch { /* not unrestrictable — fall through to the raw link */ }
    return link
  },
}
