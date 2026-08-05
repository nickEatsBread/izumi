import { invokeNativeHttp } from '$lib/net/http'
import type { DebridInfo, ResolveOpts } from './types'

// Shared helpers across debrid providers. All HTTP goes through the process-wide POOLED Rust
// client (bypasses webview CORS, keeps TLS warm). Never log the credential.

export const VIDEO = /\.(?:mkv|mp4|avi|mov|webm|flv|wmv|m4v|ts)$/i
export const JUNK = /\b(?:sample|trailer|extras?|ncop|nced|preview|pv)\b/i

const ARCHIVE_RE = /\.(?:rar|zip|7z|tar|gz|bz2|r\d{2,}|part\d+)$/i

/** True when a name or URL points at an archive rather than a playable video. Debrid services
 *  repackage some torrents into a single archive; handing one to libmpv looks like a corrupt
 *  video instead of an actionable error. Accepts either a bare filename (unrestrict's
 *  `filename` field, the more reliable signal) or a full URL — for a URL only the PATH is
 *  tested, so a query string like ?token=zip cannot produce a false positive. */
export function isArchiveName(nameOrUrl: string): boolean {
  let name = nameOrUrl.trim()
  if (/^https?:\/\//i.test(name)) {
    try { name = new URL(name).pathname } catch { /* malformed — test as-is */ }
  }
  try { name = decodeURIComponent(name) } catch { /* malformed escape — test as-is */ }
  return ARCHIVE_RE.test(name.trim())
}

/** Build a magnet from a bare btih hash, or pass an existing magnet through. */
/** Copyright-decoy guard. When a release is taken down a service can answer with a tiny
 *  placeholder clip under the real filename — playing it reads as a corrupt episode rather than a
 *  dead source, so it is worth rejecting and letting the user pick something else. Needs TWO
 *  independently reported sizes (what the torrent listed vs what the link actually serves); a
 *  provider that hands back a URL straight from its own file listing has nothing to compare and
 *  must not pretend otherwise. Half is a deliberately loose threshold: real files vary by a few
 *  percent, decoys are orders of magnitude off. */
export function isDecoy(servedBytes: number | undefined, expectedBytes: number): boolean {
  return expectedBytes > 0 && !!servedBytes && servedBytes < expectedBytes * 0.5
}

export const magnetOf = (h: string) => (h.startsWith('magnet:') ? h : `magnet:?xt=urn:btih:${h}`)
/** Extract the infoHash from a magnet, or return the bare hash (lower-cased). */
export const hashOf = (h: string) => (h.match(/urn:btih:([a-z0-9]+)/i)?.[1] ?? h).toLowerCase()

export const form = (o: Record<string, string>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) p.set(k, v)
  return p.toString()
}

/** Pick the largest real video from a {name,bytes} list (drops samples/extras). */
export function pickLargestVideo<T extends { name: string; bytes: number }>(files: T[]): T | undefined {
  const vids = files.filter((f) => VIDEO.test(f.name) && !JUNK.test(f.name))
  const pool = vids.length ? vids : files
  return [...pool].sort((a, b) => b.bytes - a.bytes)[0]
}

/** Pooled fetch + parse JSON. Returns {ok,status,json}. Never throws on non-2xx.
 *
 *  Routed through the shared Rust reqwest client rather than `@tauri-apps/plugin-http`, which
 *  builds a FRESH client per request and so paid the full ~200-300ms TCP+TLS handshake on every
 *  single call. A debrid resolve is a CHAIN of these (account list → info → select → poll…), and
 *  the poll ramp starts at 250ms — so the handshake alone used to halve the effective poll rate
 *  and add over a second to the cached-source click-to-video path.
 *
 *  `background: true` puts these on the BACKGROUND concurrency lane, not the metadata lane the
 *  UI's own queries (AniList, AniZip) ride: debrid is the app's fattest, longest-lived traffic
 *  (multi-MB account listings, minute-long poll chains), and sharing one pool let an episode
 *  resolve starve the home screen outright. GET/POST ride the pooled metadata commands; anything
 *  else (RD's DELETE) goes through the method-agnostic ext_fetch.
 *
 *  `init.signal`/`init.timeoutMs` are threaded through to the native side, which cancels the
 *  in-flight reqwest future — an aborted caller frees its lane slot instead of occupying it to
 *  completion. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function jfetch(url: string, init?: any): Promise<{ ok: boolean; status: number; json: any }> {
  const method = String(init?.method ?? 'GET').toUpperCase()
  const headers = init?.headers as Record<string, string> | undefined
  const body = typeof init?.body === 'string' ? init.body : undefined
  const opts = {
    signal: init?.signal as AbortSignal | undefined,
    timeoutMs: init?.timeoutMs as number | undefined,
  }
  const r = method === 'GET' && body == null
    ? await invokeNativeHttp<{ status: number; body: string }>('http_get', { url, headers, background: true }, opts)
    : method === 'POST'
      ? await invokeNativeHttp<{ status: number; body: string }>('http_post', { url, body: body ?? '', headers, background: true }, opts)
      : await invokeNativeHttp<{ status: number; body: string }>('ext_fetch', { url, method, headers, body }, opts)
  let json: unknown = {}
  try { json = r.body ? JSON.parse(r.body) : {} } catch { json = {} }
  return { ok: r.status >= 200 && r.status < 300, status: r.status, json }
}

/** Standard poll loop. `probe` returns DebridInfo; resolves when stage==='ready'.
 *  Aborts near-instantly: the abort check does not rely on throwIfAborted, and the
 *  between-polls sleep rejects immediately when opts.signal fires. */
// Ramp, not a fixed interval. A cached torrent is usually ready within the first second, and a flat
// 3s meant a torrent the service had ready at ~700ms was not OBSERVED until 3000ms — the resolve
// felt slow for reasons that had nothing to do with the service. Worse, the caching overlay's grace
// timer expired inside that first sleep, so a sub-second resolve presented as a full-screen
// "downloading to debrid" takeover that then vanished. The tail matters much less: a genuine
// download costs only a handful of extra probes before settling at the slow cadence, and no
// provider documents a required cadence (Real-Debrid's limit is 250 requests/minute, which this
// comes nowhere near).
const POLL_RAMP_MS = [250, 500, 750, 1000, 1500, 2000]
const POLL_MAX_MS = 3000

export async function poll(probe: () => Promise<DebridInfo>, opts: ResolveOpts = {}): Promise<void> {
  let tick = 0
  const deadline = Date.now() + (opts.timeoutMs ?? 600_000)
  const aborted = () => { if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError') }
  for (;;) {
    aborted()
    const info = await probe()
    if (info.stage === 'ready') return
    if (info.stage === 'error') throw new Error(`Torrent unavailable on debrid (${info.raw ?? 'error'}).`)
    opts.onStatus?.(info)
    if (Date.now() > deadline) throw new Error('Debrid download timed out — try a cached source.')
    // Abortable sleep: resolve on the timer, OR reject immediately if the signal aborts.
    await new Promise<void>((resolve, reject) => {
      const sig = opts.signal
      if (sig?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return }
      const onAbort = () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')) }
      const wait = opts.pollMs ?? POLL_RAMP_MS[tick++] ?? POLL_MAX_MS
      const t = setTimeout(() => { sig?.removeEventListener?.('abort', onAbort); resolve() }, wait)
      sig?.addEventListener?.('abort', onAbort, { once: true })
    })
  }
}

// --- Auth / subscription failure classification -------------------------------
// Debrid providers reject a bad/expired credential or a lapsed subscription with
// wildly different shapes: an HTTP status (Real-Debrid), a JSON envelope code
// (AllDebrid AUTH_BAD_APIKEY, TorBox BAD_TOKEN, Debrid-Link badToken), or just a
// human message (Premiumize "Invalid API key"). classifyAuth normalizes all three so
// every provider can turn "access denied" into an actionable message. Signals were
// researched per provider — see docs/superpowers/specs/2026-07-18-debrid-access-denied-messages-design.md.

export type AuthFailure = 'token' | 'subscription' | 'access' | 'quota'

// Premium / plan / trial — the account is fine but not entitled. NB: bare "expired" is
// deliberately absent (an expired *token* must stay a token failure, not subscription).
const SUBSCRIPTION_RE = /must_be_premium|free_trial|not[\s_-]?premium|premium[\s_-]?(?:required|only|member|account|subscription)|\bpremium\b|subscription|renew|\bvip\b|not[\s_-]?active|inactive|plan[\s_-]?(?:restrict|required)/i
// Bad / missing / expired key, token, or login.
const TOKEN_RE = /api[\s_-]?key|bad[\s_-]?token|badtoken|no[\s_-]?auth|auth_error|auth_bad|auth_missing|auth_blocked|auth_user_banned|invalid[\s_-]?(?:api|token|client|key|sign)|unauthor|expired[\s_-]?token|hided[\s_-]?token|token[\s_-]?error|not[\s_-]?logged|bad[\s_-]?login|login[\s_-]?fail|access[\s_-]?denied/i
// Download-quota exhaustion. OpenSubtitles returns HTTP 401 for BOTH a spent daily
// quota AND a bad key, so the body must decide — this pre-empts the 401→token fallback
// in classifyAuth. The caller must thread the response body into `message` for it to fire.
const QUOTA_RE = /you have downloaded your allowed|download (?:limit|quota)|quota[\s_-]?exceeded|too many downloads|remaining[\s_-]?downloads?\W+0\b/i

/** Content-block (DMCA/legal/content-filter) error. Carried as a NAME on the Error because the
 *  message is user-facing prose: the picker matches the name to offer a direct-P2P retry of the
 *  same torrent — the block is the service's, not the swarm's. */
export function debridBlocked(message: string): Error {
  const e = new Error(message)
  e.name = 'DebridBlocked'
  return e
}
export const isDebridBlocked = (e: unknown): boolean => e instanceof Error && e.name === 'DebridBlocked'

/** Classify an auth/subscription failure from any mix of HTTP status, provider error
 *  code, and human message. Returns undefined when it is NOT an auth/subscription
 *  problem, so the caller keeps its own specific/generic message. */
export function classifyAuth(sig: { status?: number; code?: string; message?: string }): AuthFailure | undefined {
  const text = `${sig.code ?? ''} ${sig.message ?? ''}`
  if (QUOTA_RE.test(text)) return 'quota' // body wins over status: OS returns 401 for BOTH quota and bad key
  const sub = sig.status === 402 || SUBSCRIPTION_RE.test(text)
  const tok = TOKEN_RE.test(text)
  if (sub && tok) return 'access'
  if (sub) return 'subscription'
  if (tok) return 'token'
  if (sig.status === 401) return 'token'
  if (sig.status === 403) return 'access' // locked account vs not-premium is ambiguous
  return undefined
}

/** Actionable, provider-named message for an auth/subscription failure, or undefined
 *  when the signal is not one. `credNoun` labels the credential ('login' for userpass). */
export function authError(
  provider: string,
  sig: { status?: number; code?: string; message?: string },
  credNoun = 'API key',
): string | undefined {
  const kind = classifyAuth(sig)
  if (!kind) return undefined
  if (kind === 'quota')
    return `${provider}: subtitle download limit reached — free OpenSubtitles allows 20/day. Resets in ~24h, or sign in with a VIP account in Settings → Subtitles.`
  if (kind === 'subscription')
    return `${provider}: access denied — your subscription looks inactive or expired. Renew it and try again.`
  if (kind === 'token')
    return `${provider}: access denied — your ${credNoun} looks wrong or expired. Re-check it in Settings → Extensions.`
  return `${provider}: access denied — check that your subscription is active and your ${credNoun} is correct (Settings → Extensions).`
}
