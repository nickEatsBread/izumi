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

/** Standard poll loop. `probe` returns DebridInfo; resolves when stage==='ready'. */
export async function poll(probe: () => Promise<DebridInfo>, opts: ResolveOpts = {}): Promise<void> {
  const pollMs = opts.pollMs ?? 3000
  const deadline = Date.now() + (opts.timeoutMs ?? 600_000)
  for (;;) {
    opts.signal?.throwIfAborted?.()
    const info = await probe()
    if (info.stage === 'ready') return
    if (info.stage === 'error') throw new Error(`Torrent unavailable on debrid (${info.raw ?? 'error'}).`)
    opts.onStatus?.(info)
    if (Date.now() > deadline) throw new Error('Debrid download timed out — try a cached source.')
    await new Promise((r) => setTimeout(r, pollMs))
  }
}
