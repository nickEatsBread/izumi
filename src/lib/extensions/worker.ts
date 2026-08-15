/// <reference lib="webworker" />
// Seanime provider globals (statically imported: Vite builds this worker as `iife`, which can't
// code-split, so a dynamic import here breaks the build — the cost is cheerio riding in the one
// shared worker chunk even for torrent extensions, which is fine).
import { LoadDoc as ShimLoadDoc, Buffer as ShimBuffer, CryptoJS as ShimCryptoJS, transpileSeanime, habari as ShimHabari, getUserPreference as ShimGetUserPreference } from './seanime-shim'
import { loadExtractor as runExtractor, loadEpisodeServer as runEpisodeServer } from './extractors/registry'
import { unpack as unpackJs } from './extractors/jsunpacker'
import { parseMiruHeader, createExtensionBase, adaptMiru } from './miru-shim'
import { markExtensionNavigatorOnline } from './worker-connectivity'
// One source-extension per module Worker. Untrusted extension code is loaded via a
// Blob-URL dynamic import. Isolation: a Worker has NO
// access to @tauri-apps/api / invoke, so the extension can't touch the OS or the
// app's Tauri surface. All HTTP the extension makes is bridged to the MAIN thread
// (which performs it via the CORS-free Tauri http plugin), so we never expose Tauri
// to the extension AND sidestep webview CORS. This file runs in a worker context.

interface FetchResp { ok: boolean; status: number; url?: string; headers?: Record<string, string>; setCookie?: string[]; body: string }

// A source should attempt its bridged request and let that real request establish connectivity.
// WebView/worker navigator hints describe the web sandbox, while our HTTP actually runs in Rust.
markExtensionNavigatorOnline(globalThis.navigator)

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

/** Evaluate untrusted extension source as a module via a Blob URL, revoking it either way. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function importModule(code: string): Promise<any> {
  const blobUrl = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }))
  try { return await import(/* @vite-ignore */ blobUrl) }
  finally { URL.revokeObjectURL(blobUrl) }
}

/** A SyntaxError, which a module raises when it fails to PARSE — but also when its body throws one
 * while running (`JSON.parse('{oops')`, `new RegExp('[')`). The class alone cannot tell those apart,
 * so the parse marker in `importSeanimeProvider` is what actually separates them. */
function isSyntaxError(err: unknown): boolean {
  return err instanceof SyntaxError || (err as { name?: string } | null)?.name === 'SyntaxError'
}

let parseProbe = 0

// Load a Seanime-shaped payload, whose bare `class Provider {}` we expose as the module's default.
// The payload is imported VERBATIM first and only type-stripped if that is what the parse choked on:
// the transpiler is a TypeScript parser, and on the JS-only constructs it doesn't model it rewrites
// silently rather than erroring (`f < a > (b)` becomes the call `f(b)`, decorators vanish), so a
// plain-JS provider — which never needed transpiling — must not be run through it at all. Only a
// payload that never PARSED may be retried: a module whose body already started running can have left
// side effects behind, and a SyntaxError thrown from that body looks identical to a parse failure. The
// marker below is the module's first statement, so it can only have run if the whole module parsed;
// it is kept on line 1 so the payload's own line numbers stay intact in stack traces.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function importSeanimeProvider(code: string): Promise<any> {
  const withDefault = (src: string) => `${src}\n;export default (typeof Provider !== 'undefined' ? new Provider() : {});`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any
  const marker = `__izumiParsed${++parseProbe}`
  try { return await importModule(`;globalThis[${JSON.stringify(marker)}]=1;${withDefault(code)}`) }
  catch (err) {
    if (g[marker] === 1 || !isSyntaxError(err)) throw err
    return await importModule(withDefault(transpileSeanime(code)))
  }
  finally { delete g[marker] }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
self.onmessage = async (e: MessageEvent<any>) => {
  const msg = e.data
  try {
    if (msg.type === 'load') {
      const code: string = msg.code
      extensionName = typeof msg.name === 'string' && msg.name ? msg.name : undefined
      // A second community format, detected from the payload's own banner rather than from catalog
      // metadata — the same file is valid whether it arrived via a catalog or a direct URL, and the
      // banner is the only thing guaranteed to travel with it. Its `export default class extends
      // Extension` needs that base class present as a global BEFORE the module is evaluated.
      const miruMeta = parseMiruHeader(code)
      if (miruMeta) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const g = globalThis as any
        g.Extension = createExtensionBase(miruMeta, bridgedFetch as never)
        const mod = await importModule(code)
        const Ext = mod.default
        if (typeof Ext !== 'function') throw new Error('extension has no default export')
        const instance = new Ext()
        // Extensions may register settings / warm state in load(); best-effort, never fatal.
        // Wrapped rather than chained: an extension may override load() synchronously, and calling
        // .catch on its undefined return would throw before the guard applied.
        await Promise.resolve(instance.load?.()).catch(() => {})
        source = adaptMiru(instance)
        postMessage({ type: 'loaded', id: msg.id })
        return
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let mod: any
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
        mod = await importSeanimeProvider(code)
      } else {
        mod = await importModule(code)
      }
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
