import { invoke } from '@tauri-apps/api/core'
import { get } from 'svelte/store'
import { phttp } from '$lib/net/http'
import { enabledExtensionUrls, disabledPlugins } from '$lib/settings/ui'
import type { TorrentResult, TorrentQuery, ExtensionConfig } from './types'
import { resolveManifestUrl, normalizeManifest, pointerUrl, isRunnableType, manifestProblem } from './catalog'
import { clearProviderCache } from '$lib/stremio/online-cache'

// Main-thread orchestrator for source extensions. Loads each manifest, spawns one
// isolated Worker per extension, bridges the extensions' HTTP through the CORS-free
// Tauri http plugin, fans out searches, and dedupes results by hash. Best-effort:
// a broken extension/manifest is skipped, never thrown, so the Stremio-addon flow
// is unaffected. See worker.ts for the isolation model.

interface RunningExt {
  cfg: ExtensionConfig
  worker: Worker
  ready: Promise<boolean>
  seq: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  waits: Map<number, (m: any) => void>
}

let running: RunningExt[] | null = null
let builtFrom = ''

// Fetch a manifest by spec and expand it into ExtensionConfig[]. A top-level GitHub
// repo index (array of {main} pointers) is expanded one level into its per-folder
// manifests; a normal manifest is normalized directly. Best-effort: [] on failure.
async function expandManifest(spec: string, depth = 0): Promise<ExtensionConfig[]> {
  const url = resolveManifestUrl(spec)
  // Pooled client — plugin-http builds a fresh reqwest client per request (~300ms handshake),
  // which multiplied across a repo's manifests + modules made the first resolve crawl.
  const r = await phttp(url)
  if (!r.ok) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = await r.json()
  const entries = Array.isArray(raw) ? raw : [raw]
  // Partition rather than all-or-nothing: a marketplace may mix pointer entries with inline
  // configs, and `every(isPointer)` silently dropped the whole catalog when even one differed.
  // Pointers carrying an unrunnable `type` are dropped WITHOUT a fetch.
  const pointers = depth === 0
    ? entries.filter((e) => pointerUrl(e) && isRunnableType(e))
    : []
  if (pointers.length) {
    const nested = await Promise.all(pointers.map((e) => expandManifest(pointerUrl(e)!, depth + 1).catch(() => [])))
    const inline = entries.filter((e) => !pointerUrl(e))
    return [...nested.flat(), ...normalizeManifest(inline, url)]
  }
  return normalizeManifest(raw, url)
}

/** Fetch + expand a single stored spec for display (name/icon/version) in the
 *  settings list. Best-effort: [] on failure. */
export async function fetchExtensionMeta(spec: string): Promise<ExtensionConfig[]> {
  try { return await expandManifest(spec) } catch { return [] }
}

/** Like `fetchExtensionMeta`, plus an explanation when nothing runnable came back — so a source
 *  that can never work (a compiled Android plugin repo, say) says so instead of silently showing
 *  an empty list. The diagnostic re-fetches the manifest, but only on the failure path. */
export async function fetchExtensionInfo(spec: string): Promise<{ configs: ExtensionConfig[]; problem?: string }> {
  const configs = await fetchExtensionMeta(spec)
  if (configs.length) return { configs }
  try {
    const r = await phttp(resolveManifestUrl(spec))
    if (!r.ok) return { configs, problem: `That URL returned HTTP ${r.status}.` }
    return { configs, problem: manifestProblem(await r.json()) }
  } catch {
    return { configs, problem: 'That URL could not be fetched.' }
  }
}

async function loadConfigs(): Promise<ExtensionConfig[]> {
  // Each spec is an independent network fetch, so awaiting them one at a time made warm-up cost the
  // SUM of every manifest round-trip. Order is preserved by Promise.all, and a bad manifest still
  // degrades to [] on its own without taking the others down.
  const results = await Promise.all(
    get(enabledExtensionUrls).map((spec) =>
      expandManifest(spec).catch(() => [] as ExtensionConfig[])),
  )
  // A source URL expands to many plugins; drop the ones switched off individually. Filtered HERE
  // rather than at query time so a disabled plugin never has its module fetched or a worker spawned.
  const off = get(disabledPlugins)
  return results.flat().filter((c) => !off.includes(c.id))
}

// Fetch an extension's module source. esm.sh often returns a tiny re-export STUB
// pointing at the hashed build (`export * from "/gh/…"`); a blob import of that text
// can't resolve the relative target, so follow it once to the real module.
async function fetchModuleCode(url: string): Promise<string | null> {
  const r = await phttp(url)
  if (!r.ok) return null
  const code = await r.text()
  const stub = code.match(/export\s+\*\s+from\s*["']([^"']+)["']/)
  if (stub && code.trim().length < 600) {
    const t = stub[1]
    const target = /^https?:\/\//i.test(t) ? t : `https://esm.sh${t.startsWith('/') ? '' : '/'}${t}`
    try { const r2 = await phttp(target); if (r2.ok) return await r2.text() } catch { /* keep stub */ }
  }
  return code
}

function spawn(cfg: ExtensionConfig, code: string): RunningExt {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  const ext: RunningExt = { cfg, worker, seq: 0, waits: new Map(), ready: Promise.resolve(false) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  worker.onmessage = async (e: MessageEvent<any>) => {
    const m = e.data
    if (m.type === 'fetch') {
      // Run the extension's HTTP on the main thread via the pooled Rust client (CORS-free).
      // NOT the webview/plugin-http fetch: that normalizes through a `Request`, which strips
      // forbidden headers (Referer, Origin, Cookie, …). Many streaming embeds gate the actual
      // stream URL on Referer, so plugin-http silently resolved nothing. reqwest forwards every
      // header the extension set. See ext_fetch in lib.rs.
      try {
        const init = m.init ?? {}
        const r = await invoke<{ status: number; url: string; headers: Record<string, string>; setCookie: string[]; body: string }>('ext_fetch', {
          url: m.url,
          method: init.method,
          headers: init.headers,
          body: typeof init.body === 'string' ? init.body : undefined,
        })
        worker.postMessage({ type: 'fetch-result', reqId: m.reqId, res: { ok: r.status >= 200 && r.status < 300, status: r.status, url: r.url, headers: r.headers, setCookie: r.setCookie, body: r.body } })
      } catch (err) {
        worker.postMessage({ type: 'fetch-result', reqId: m.reqId, error: String(err) })
      }
    } else if (m.type === 'loaded' || m.type === 'result') {
      const w = ext.waits.get(m.id)
      if (w) { ext.waits.delete(m.id); w(m) }
    }
  }
  ext.ready = new Promise<boolean>((resolve) => {
    const id = ++ext.seq
    // A wedged worker (e.g. a shim module-eval error before onmessage is wired) must NOT hang the
    // pipeline — queryExtensions/runningStreamExtensions Promise.all on every ext.ready. Time out to
    // "not ready" after 20s, and treat a worker error the same way.
    const t = setTimeout(() => { ext.waits.delete(id); resolve(false) }, 20000)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ext.waits.set(id, (m: any) => { clearTimeout(t); resolve(!m.error) })
    worker.onerror = () => { clearTimeout(t); ext.waits.delete(id); resolve(false) }
    // `name` rides along so host-side helpers running inside the worker (the embed extractors) can
    // attribute what they resolve back to the extension that asked, instead of returning anonymous
    // links the picker then has to label generically.
    worker.postMessage({ type: 'load', id, code, name: cfg.name, settings: cfg.settings, kind: cfg.type === 'onlinestream-provider' ? 'seanime' : cfg.type === 'anime-torrent-provider' ? 'atp' : undefined })
  })
  return ext
}

// In-flight build so concurrent callers (torrent wave + streaming wave in the same play) share ONE
// build instead of one racing ahead and reading a half-built `running`. `running`/`builtFrom` are
// published only AFTER the build completes.
let buildPromise: Promise<RunningExt[]> | null = null
async function ensureRunning(): Promise<RunningExt[]> {
  // The key must cover the per-plugin switches too: keyed on the URL list alone, toggling a plugin
  // left the previous worker set live and the change did nothing until a URL was added or removed.
  const key = JSON.stringify([get(enabledExtensionUrls), get(disabledPlugins)])
  if (running && builtFrom === key) return running
  if (buildPromise) return buildPromise
  buildPromise = (async () => {
    running?.forEach((e) => e.worker.terminate())
    // The resolver memoizes each provider's search/episode/settings answers. Those belong to the
    // PREVIOUS set of workers, so a provider that was just enabled, disabled or updated must not
    // keep serving results from its old incarnation.
    clearProviderCache()
    // Fetch every module in parallel — sequentially this was N × (esm.sh latency), the bulk of the
    // first-resolve stall for multi-source repos.
    const cfgs = await loadConfigs()
    const codes = await Promise.all(cfgs.map(async (cfg) => {
      try { return { cfg, code: await fetchModuleCode(cfg.code) } } catch { return { cfg, code: null } }
    }))
    const next: RunningExt[] = []
    for (const { cfg, code } of codes) if (code) next.push(spawn(cfg, code))
    running = next
    builtFrom = key
    return next
  })()
  try { return await buildPromise }
  finally { buildPromise = null }
}

/** How many extensions will actually be queried. NOT the URL count — one source URL expands to many
 *  plugins (a marketplace index yields ~18), so only this can answer "is there exactly one source?". */
export async function runningExtensionCount(): Promise<number> {
  if (!get(enabledExtensionUrls).length) return 0
  return (await ensureRunning()).length
}

/** Pre-boot the extension runtime (manifest + modules + workers) off the click-to-play path.
 *  Called once at app start; the first picker open then only pays the actual search. */
export function warmExtensions(): void {
  if (get(enabledExtensionUrls).length) void ensureRunning().catch(() => {})
}

function call(ext: RunningExt, method: string, query: TorrentQuery): Promise<TorrentResult[]> {
  return new Promise((resolve) => {
    const id = ++ext.seq
    const t = setTimeout(() => { ext.waits.delete(id); resolve([]) }, 20000)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ext.waits.set(id, (m: any) => { clearTimeout(t); resolve(Array.isArray(m.results) ? m.results : []) })
    ext.worker.postMessage({ type: 'query', id, method, query })
  })
}

/** Query every enabled extension for an episode; dedupe by hash. Best-effort:
 *  returns [] when none are configured or all fail. Never throws.
 *  `onBatch` (optional) fires with each extension's results AS IT SETTLES, so the picker can
 *  fold sources in live instead of waiting on the slowest (or a wedged one's 20s timeout). */
export async function queryExtensions(query: TorrentQuery, onBatch?: (rs: TorrentResult[]) => void, onlyId?: string): Promise<TorrentResult[]> {
  try {
    if (!get(enabledExtensionUrls).length) return []
    const exts = await ensureRunning()
    const candidates = exts.filter((e) => !onlyId || e.cfg.id === onlyId)
    const live = (await Promise.all(candidates.map(async (e) => ((await e.ready) ? e : null))))
      .filter((e): e is RunningExt => !!e)
    // Movies also get single(): SDK sources treat single() as the universal entry (their movie()
    // often returns [] with "single already gets movies with matching media id").
    const methods = query.episode != null ? ['single', 'batch'] : ['single', 'movie']
    // Stamp each result with the extension that produced it (name + icon), mirroring the
    // torrent-provider path, so the picker labels the row with the real source instead of the
    // generic "Extension" fallback. Per-extension map (not a flat fan-out) keeps that association.
    const batches = await Promise.all(live.map(async (e) => {
      const rs = (await Promise.all(methods.map((m) => call(e, m, query)))).flat()
      const stamped = rs.map((r) => ({
        ...r,
        provider: r.provider ?? e.cfg.name,
        providerId: e.cfg.id,
        logo: r.logo ?? e.cfg.icon,
      }))
      if (onBatch && stamped.length) onBatch(stamped)
      return stamped
    }))
    const seen = new Set<string>()
    const out: TorrentResult[] = []
    for (const r of batches.flat()) {
      if (!r?.hash || seen.has(r.hash)) continue
      seen.add(r.hash)
      out.push(r)
    }
    return out
  } catch { return [] }
}

// Raw multi-arg call for Seanime onlinestream providers: source[method](...args), returning the
// raw result (object OR array). 20s cap → null on timeout. (Torrent uses `call()` which coerces.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callRaw(ext: RunningExt, method: string, args: unknown[]): Promise<any> {
  return new Promise((resolve) => {
    const id = ++ext.seq
    const t = setTimeout(() => { ext.waits.delete(id); resolve(null) }, 20000)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ext.waits.set(id, (m: any) => { clearTimeout(t); resolve(m.results) })
    ext.worker.postMessage({ type: 'query', id, method, args })
  })
}

/** The live onlinestream-provider extensions, each with a bound multi-arg `call`. The
 *  orchestrator (stremio/onlinestream) drives search/findEpisodes/findEpisodeServer through it. */
export async function runningStreamExtensions(onlyId?: string): Promise<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { id: string; name: string; lang?: string; call: (method: string, ...args: unknown[]) => Promise<any> }[]
> {
  if (!get(enabledExtensionUrls).length) return []
  const exts = await ensureRunning()
  const live = (await Promise.all(
    exts.filter((e) => !onlyId || e.cfg.id === onlyId)
      .map(async (e) => ((await e.ready) && e.cfg.type === 'onlinestream-provider' ? e : null)),
  )).filter(Boolean) as RunningExt[]
  return live.map((e) => ({ id: e.cfg.id, name: e.cfg.name, lang: e.cfg.lang, call: (method: string, ...args: unknown[]) => callRaw(e, method, args) }))
}

/** The live anime-torrent-provider extensions, each with a bound multi-arg `call`.
 *  torrentProvider.queryTorrentProviders drives search/smartSearch through it. */
export async function runningTorrentProviderExtensions(onlyId?: string): Promise<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { id: string; name: string; icon?: string; call: (method: string, ...args: unknown[]) => Promise<any> }[]
> {
  if (!get(enabledExtensionUrls).length) return []
  const exts = await ensureRunning()
  const live = (await Promise.all(
    exts.filter((e) => !onlyId || e.cfg.id === onlyId)
      .map(async (e) => ((await e.ready) && e.cfg.type === 'anime-torrent-provider' ? e : null)),
  )).filter(Boolean) as RunningExt[]
  return live.map((e) => ({ id: e.cfg.id, name: e.cfg.name, icon: e.cfg.icon, call: (method: string, ...args: unknown[]) => callRaw(e, method, args) }))
}
