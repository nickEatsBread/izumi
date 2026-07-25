/// <reference lib="webworker" />
// Seanime provider globals (statically imported: Vite builds this worker as `iife`, which can't
// code-split, so a dynamic import here breaks the build — the cost is cheerio riding in the one
// shared worker chunk even for torrent extensions, which is fine).
import { LoadDoc as ShimLoadDoc, Buffer as ShimBuffer, CryptoJS as ShimCryptoJS, transpileSeanime, habari as ShimHabari, getUserPreference as ShimGetUserPreference } from './seanime-shim'
import { loadExtractor as runExtractor, loadEpisodeServer as runEpisodeServer } from './extractors/registry'
import { unpack as unpackJs } from './extractors/jsunpacker'
// One source-extension per module Worker. Untrusted extension code is loaded via a
// Blob-URL dynamic import. Isolation: a Worker has NO
// access to @tauri-apps/api / invoke, so the extension can't touch the OS or the
// app's Tauri surface. All HTTP the extension makes is bridged to the MAIN thread
// (which performs it via the CORS-free Tauri http plugin), so we never expose Tauri
// to the extension AND sidestep webview CORS. This file runs in a worker context.

interface FetchResp { ok: boolean; status: number; url?: string; headers?: Record<string, string>; setCookie?: string[]; body: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let source: any = null
const pending = new Map<number, { resolve: (v: FetchResp) => void; reject: (e: unknown) => void }>()
let reqSeq = 0

// The `fetch` handed to extensions: proxy the request to the main thread and return
// a minimal Response-like object (extensions use .ok/.status/.json()/.text()).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bridgedFetch(url: string | URL, init?: any) {
  const reqId = ++reqSeq
  const p = new Promise<FetchResp>((resolve, reject) => {
    pending.set(reqId, { resolve, reject })
    postMessage({
      type: 'fetch', reqId, url: String(url),
      init: init ? { method: init.method, headers: init.headers, body: init.body } : undefined,
    })
  })
  return p.then((res) => ({
    ok: res.ok,
    status: res.status,
    // Post-redirect URL, so a scraper can resolve relative links against where it actually landed.
    url: res.url ?? String(url),
    headers: new Map(Object.entries(res.headers ?? {})),
    // Every `Set-Cookie` line, in order — the flat header map keeps only the last one. The Rust
    // client also holds its own jar, so a provider only needs these to READ a cookie's value.
    setCookie: res.setCookie ?? [],
    text: async () => res.body,
    json: async () => JSON.parse(res.body),
  }))
}
// Extensions may call a global fetch too — override it in the worker scope.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).fetch = bridgedFetch

// This extension's display name, set at load. Carried into every extractor call so a resolved
// embed is attributed to the extension that asked rather than arriving anonymous.
let extensionName: string | undefined

// Host-owned embed extraction, available to every provider as `$loadExtractor(url, referer)` —
// izumi's equivalent of the reference app's `loadExtractor`. A provider that scrapes an embed link
// hands it over instead of reimplementing the host.
//   $loadExtractor     → { links, subtitles }, for providers that want the raw result
//   $loadEpisodeServer → the findEpisodeServer shape, so a provider can return it directly and get
//                        the resolving host's name on the row for free
// `$unpack` is exposed alongside for providers that need the decoded page for their own parsing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).$loadExtractor = (url: string, referer?: string) =>
  runExtractor(url, { fetch: bridgedFetch as never, referer, extension: extensionName })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).$loadEpisodeServer = (url: string, referer?: string) =>
  runEpisodeServer(url, { fetch: bridgedFetch as never, referer, extension: extensionName })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).$unpack = unpackJs

// eslint-disable-next-line @typescript-eslint/no-explicit-any
self.onmessage = async (e: MessageEvent<any>) => {
  const msg = e.data
  try {
    if (msg.type === 'load') {
      let code: string = msg.code
      extensionName = typeof msg.name === 'string' && msg.name ? msg.name : undefined
      // Seanime providers are a bare `class Provider {}` (no export) using a global `fetch`
      // (already overridden above) + occasionally `$sleep`. Instantiate it + provide $sleep.
      if (msg.kind === 'seanime' || msg.kind === 'atp') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const g = globalThis as any
        g.$sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
        g.LoadDoc = ShimLoadDoc
        g.Buffer = ShimBuffer
        g.CryptoJS = ShimCryptoJS
        if (msg.kind === 'atp') {
          g.$habari = ShimHabari
          g.$getUserPreference = ShimGetUserPreference
        }
        code = transpileSeanime(code) // strip TS types so raw-TS payloads load
        code = `${code}\n;export default (typeof Provider !== 'undefined' ? new Provider() : {});`
      }
      const blob = new Blob([code], { type: 'application/javascript' })
      const blobUrl = URL.createObjectURL(blob)
      const mod = await import(/* @vite-ignore */ blobUrl)
      URL.revokeObjectURL(blobUrl)
      source = mod.default ?? mod
      if (source && msg.settings) source.settings = msg.settings
      postMessage({ type: 'loaded', id: msg.id })
    } else if (msg.type === 'query') {
      if (!source) throw new Error('extension not loaded')
      let results: unknown
      if (Array.isArray(msg.args)) {
        // Seanime multi-arg call: source.method(...args) with the real args (e.g.
        // findEpisodeServer(episode, server)). Return the RAW result (may be an object).
        const fn = source[msg.method]
        results = typeof fn === 'function' ? await fn.apply(source, msg.args) : null
      } else {
        // izumi torrent extension: single query object with a bridged fetch attached.
        const q = { ...msg.query, fetch: bridgedFetch }
        const fn = source[msg.method]
        results = typeof fn === 'function' ? await fn.call(source, q) : []
      }
      postMessage({ type: 'result', id: msg.id, results })
    } else if (msg.type === 'fetch-result') {
      const w = pending.get(msg.reqId)
      if (w) { pending.delete(msg.reqId); msg.error ? w.reject(new Error(msg.error)) : w.resolve(msg.res) }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (msg.type === 'load') postMessage({ type: 'loaded', id: msg.id, error: message })
    else if (msg.type === 'query') postMessage({ type: 'result', id: msg.id, results: [], error: message })
  }
}
