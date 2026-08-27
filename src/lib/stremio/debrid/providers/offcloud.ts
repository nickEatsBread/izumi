import { jfetch, magnetOf, poll, authError, debridHttpError } from '../http'
import { pickVideoFile } from '../episode-file'
import type { DebridProvider, DebridInfo } from '../types'

// Offcloud. add /cloud → wait for 'downloaded' → /cloud/explore/{id} returns direct CDN
// URLs (single-file torrents expose the link in the add response). Requires the "cloud
// downloading" add-on on the account.
//
// Offcloud publishes no API docs, and the API was REWRITTEN in early 2026 — the shape
// here follows the open-source client that adapted to it (StremThru, commit 51aa5c4
// "adapt to new offcloud api", 2026-03-07, which is exactly the before/after diff):
//   • auth moved from the ?key= query param to an Authorization: Bearer header,
//   • bodies are JSON,
//   • it stopped polling POST /cloud/status per request — status now comes from the add
//     response and from GET /cloud/history (that route does still answer, though: a live
//     probe gets 401 NOAUTH, where an unknown route 404s, so it stays as our fallback),
//   • GET /cloud/explore/{id}?format=detailed returns {files:[{name,size,path,url}]}
//     instead of a bare array of URLs.
// A live key was not available to confirm which generation a given account talks to, so
// this sends BOTH credentials (header + query param), reads status from history with a
// fall back to /cloud/status, and parses BOTH explore shapes. All of that is additive —
// nothing here breaks an account still on the old API.

const BASE = 'https://offcloud.com/api'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function oc(method: string, path: string, key: string, body?: unknown, priority?: boolean): Promise<any> {
  const sep = path.includes('?') ? '&' : '?'
  const { ok, status, json } = await jfetch(`${BASE}${path}${sep}key=${encodeURIComponent(key)}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    priority,
  })
  const auth = authError('Offcloud', { status, message: json?.error })
  if (auth) throw new Error(auth)
  // Every other non-2xx used to fall straight through: jfetch does not throw, it returns `{}`, and
  // ocStatus maps an absent status to 'downloading' — so a dead service pinned the caching overlay
  // for the poll's full deadline. debridHttpError tags a 5xx — and a 429, on its own longer budget
  // — so poll retries instead of killing a download in progress; the 404 that means "this
  // generation of the API has no such route" stays fatal to whoever asked. Both callers that
  // legitimately expect a route to be
  // missing (the /cloud/history probe, and /cloud/explore for a legacy single-file torrent)
  // already catch, so they keep their fallbacks either way.
  if (!ok) throw debridHttpError(status, json?.error ?? `Offcloud request failed (${status}).`)
  return json
}

/** Pure map of an Offcloud cloud-download status string to a DebridInfo. Offcloud
 *  exposes only the textual stage (no %/seeders/speed) — stage-only by design. */
export function ocStatus(s: string | undefined): DebridInfo {
  if (s === 'downloaded') return { stage: 'ready', progress: 100, raw: s }
  if (s === 'error' || s === 'canceled') return { stage: 'error', raw: s }
  return { stage: s === 'created' || s === 'queued' ? 'queued' : 'downloading', raw: s }
}

export interface OcFile { name: string; bytes: number; url: string }

/** Normalize both /cloud/explore generations: the current {files:[{name,size,path,url}]}
 *  and the legacy bare array of download URLs. Entries without a URL are dropped. The
 *  current shape carries real sizes, so the episode picker gets a size tiebreak; on the
 *  legacy shape every size is 0 and the pick is filename-only. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ocFiles(explore: any): OcFile[] {
  const raw: unknown[] = Array.isArray(explore) ? explore : (explore?.files ?? [])
  const base = (p: string) => decodeURIComponent(p.split(/[/\\]/).pop() ?? '')
  return raw
    .map((f): OcFile => {
      if (typeof f === 'string') return { name: base(f), bytes: 0, url: f }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const o = f as any
      return { name: base(o?.path ?? o?.name ?? ''), bytes: o?.size ?? 0, url: o?.url ?? '' }
    })
    .filter((f) => !!f.url)
}

/** Current status of one request: history first (current API), legacy per-request
 *  status endpoint as a fall back. Undefined when neither knows it yet. */
async function ocRequestStatus(key: string, rid: string, priority?: boolean): Promise<string | undefined> {
  try {
    const hist = await oc('GET', '/cloud/history', key, undefined, priority)
    const items = Array.isArray(hist) ? hist : (hist?.history ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const it = items.find((x: any) => x?.requestId === rid)
    if (it?.status) return it.status
  } catch { /* endpoint absent on the legacy API — fall through */ }
  const st = await oc('POST', '/cloud/status', key, { requestId: rid }, priority)
  return st?.status?.status ?? st?.status
}

export const offcloud: DebridProvider = {
  id: 'offcloud',
  name: 'Offcloud',
  keyHint: 'offcloud.com/#/account',
  credential: 'apikey',
  // Offcloud does have a /api/cache/info endpoint, but izumi's client here authenticates with a
  // ?key= query param while Offcloud's early-2026 API rewrite requires an Authorization: Bearer
  // header. The client must be fixed and verified against a live key before a cache check is
  // layered on top of it — shipping it now would just relabel a request that's already broken.
  cacheCheck: 'none',
  async resolveHash(key, hashOrMagnet, opts) {
    if (!key) throw new Error('No Offcloud API key set — add it in Settings → Sources → Playback.')
    // POST /cloud creates a cloud download on the account. /cloud/history does list past
    // requests, but nothing in it is documented or verified to carry the source magnet's hash,
    // so matching a prefetch against it would be guesswork — and guessing wrong here either adds
    // the torrent anyway or serves a link to a different release. Decline instead: noAdd's
    // contract is that nothing speculative is ever created.
    if (opts?.noAdd) throw new Error("Offcloud needs to add this release, which background prefetch isn't allowed to do.")
    const add = await oc('POST', '/cloud', key, { url: magnetOf(hashOrMagnet) }, opts?.priority)
    if (add?.not_available) throw new Error(`Offcloud can't take that link on your plan (${add.not_available} add-on required).`)
    if (add?.status === 'error' || !add?.requestId) throw new Error(add?.error ?? 'Offcloud rejected the magnet (cloud add-on required?).')
    const rid: string = add.requestId
    // The add response already carries the stage — spend the first poll on it instead of
    // an immediate round-trip (cached torrents come back 'downloaded' right here).
    let known: string | undefined = add.status
    await poll(async () => {
      const s = known ?? await ocRequestStatus(key, rid, opts?.priority)
      known = undefined
      return ocStatus(s)
    }, opts)
    let files: OcFile[] = []
    // Legacy single-file torrents skip explore and expose the link on the add response —
    // that fallback is the only reason an explore failure is ever swallowed.
    try { files = ocFiles(await oc('GET', `/cloud/explore/${rid}?format=detailed`, key, undefined, opts?.priority)) }
    catch (e) { if (!add.url) throw e }
    if (!files.length && add.url) files = ocFiles([add.url])
    const best = pickVideoFile(files, opts?.want) ?? files[0]
    if (!best?.url) throw new Error('No playable file in that torrent.')
    return best.url
  },
}
