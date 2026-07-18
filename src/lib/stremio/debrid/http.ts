import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import type { DebridInfo, ResolveOpts } from './types'

// Shared helpers across debrid providers. All HTTP goes through the Tauri plugin
// (bypasses webview CORS). Never log the credential.

export const VIDEO = /\.(?:mkv|mp4|avi|mov|webm|flv|wmv|m4v|ts)$/i
export const JUNK = /\b(?:sample|trailer|extras?|ncop|nced|preview|pv)\b/i

/** Build a magnet from a bare btih hash, or pass an existing magnet through. */
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

/** httpFetch + parse JSON. Returns {ok,status,json}. Never throws on non-2xx. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function jfetch(url: string, init?: any): Promise<{ ok: boolean; status: number; json: any }> {
  const r = await httpFetch(url, init)
  const txt = await r.text()
  let json: unknown = {}
  try { json = txt ? JSON.parse(txt) : {} } catch { json = {} }
  return { ok: r.ok, status: r.status, json }
}

/** Standard poll loop. `probe` returns DebridInfo; resolves when stage==='ready'.
 *  Aborts near-instantly: the abort check does not rely on throwIfAborted, and the
 *  between-polls sleep rejects immediately when opts.signal fires. */
export async function poll(probe: () => Promise<DebridInfo>, opts: ResolveOpts = {}): Promise<void> {
  const pollMs = opts.pollMs ?? 3000
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
      const t = setTimeout(() => { sig?.removeEventListener?.('abort', onAbort); resolve() }, pollMs)
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

export type AuthFailure = 'token' | 'subscription' | 'access'

// Premium / plan / trial — the account is fine but not entitled. NB: bare "expired" is
// deliberately absent (an expired *token* must stay a token failure, not subscription).
const SUBSCRIPTION_RE = /must_be_premium|free_trial|not[\s_-]?premium|premium[\s_-]?(?:required|only|member|account|subscription)|\bpremium\b|subscription|renew|\bvip\b|not[\s_-]?active|inactive|plan[\s_-]?(?:restrict|required)/i
// Bad / missing / expired key, token, or login.
const TOKEN_RE = /api[\s_-]?key|bad[\s_-]?token|badtoken|no_auth|auth_error|auth_bad|auth_missing|auth_blocked|auth_user_banned|invalid[\s_-]?(?:api|token|client|key|sign)|unauthor|expired[\s_-]?token|hided[\s_-]?token|token[\s_-]?error|not[\s_-]?logged|bad[\s_-]?login|login[\s_-]?fail|access[\s_-]?denied/i

/** Classify an auth/subscription failure from any mix of HTTP status, provider error
 *  code, and human message. Returns undefined when it is NOT an auth/subscription
 *  problem, so the caller keeps its own specific/generic message. */
export function classifyAuth(sig: { status?: number; code?: string; message?: string }): AuthFailure | undefined {
  const text = `${sig.code ?? ''} ${sig.message ?? ''}`
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
  if (kind === 'subscription')
    return `${provider}: access denied — your subscription looks inactive or expired. Renew it and try again.`
  if (kind === 'token')
    return `${provider}: access denied — your ${credNoun} looks wrong or expired. Re-check it in Settings → Extensions.`
  return `${provider}: access denied — check that your subscription is active and your ${credNoun} is correct (Settings → Extensions).`
}
