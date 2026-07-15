import { invoke } from '@tauri-apps/api/core'
import { get } from 'svelte/store'
import { phttp } from '$lib/net/http'
import { enabledExtensionUrls } from '$lib/settings/ui'
import type { TorrentResult, TorrentQuery, ExtensionConfig } from './types'

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

// Turn a stored spec into a fetchable manifest URL. Accepts these forms:
//   gh:owner/repo[/sub]      → https://esm.sh/gh/owner/repo[/sub]/index.json
//   owner/repo[/sub]         → same (GitHub shorthand, matches the settings display)
//   npm:pkg[/sub]            → https://esm.sh/pkg[/sub]/index.json
//   https://…                → as given (existing full-URL manifests)
function resolveManifestUrl(spec: string): string {
  const s = spec.trim()
  if (/^https?:\/\//i.test(s)) return s
  if (s.startsWith('gh:')) return withIndexJson(`https://esm.sh/gh/${s.slice(3).replace(/\/+$/, '')}`)
  if (s.startsWith('npm:')) return withIndexJson(`https://esm.sh/${s.slice(4).replace(/\/+$/, '')}`)
  // Bare GitHub shorthand: owner (no dots) / repo[/sub].
  if (/^[A-Za-z0-9][A-Za-z0-9-]*\/[^\s:]+$/.test(s)) return withIndexJson(`https://esm.sh/gh/${s.replace(/\/+$/, '')}`)
  return withIndexJson(`https://${s}`)
}
const withIndexJson = (base: string) => (/\.json(\?|$)/i.test(base) ? base : `${base.replace(/\/+$/, '')}/index.json`)

// gh:/npm: → esm.sh; http(s) passthrough; relative (`main`) → resolve against
// the manifest URL, append .js when it has no extension.
function resolveSpecUrl(spec: string, manifestUrl: string): string {
  if (spec.startsWith('gh:')) return `https://esm.sh/gh/${spec.slice(3)}`
  if (spec.startsWith('npm:')) return `https://esm.sh/${spec.slice(4)}`
  if (/^https?:\/\//i.test(spec)) return spec
  const base = manifestUrl.replace(/\/[^/]*$/, '/')
  const u = new URL(spec, base).toString()
  return /\.(m?js)$/i.test(u) ? u : `${u}.js`
}

// Resolve an entry's module URL. Some SourceConfigs carry an `update` gh-pointer to
// their folder; the code lives at esm.sh/gh/<owner>/<repo>/es2022/<sub>/<main>.mjs
// (esm.sh's transpiled form). Flat configs carry a `code` spec we resolve
// directly. Falls back to resolving `main` relative to the manifest URL.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveCodeUrl(e: any, manifestUrl: string): string {
  if (e.code) return resolveSpecUrl(String(e.code), manifestUrl)
  const main = String(e.main).replace(/\.(m?js)$/i, '')
  const update = Array.isArray(e.update) ? e.update[0] : e.update
  if (typeof update === 'string' && update.startsWith('gh:')) {
    const [owner, repo, ...rest] = update.slice(3).replace(/\/+$/, '').split('/')
    if (owner && repo) return `https://esm.sh/gh/${owner}/${repo}/es2022/${[...rest, main].join('/')}.mjs`
  }
  return resolveSpecUrl(String(e.main), manifestUrl)
}

// A repository-index entry is a bare pointer (only `main`/`url`, none of the
// SourceConfig identity fields) — a catalog form. Such a manifest expands into
// its referenced per-folder manifests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isRepoPointer(e: any): boolean {
  return !!e && typeof e === 'object' && (e.main || e.url)
    && e.id == null && e.name == null && e.code == null && e.update == null && e.type == null && e.version == null
}

// Normalize both flat configs (with `code`) and manifest arrays (with
// `main` + `update`) into ExtensionConfig[].
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeManifest(raw: any, manifestUrl: string): ExtensionConfig[] {
  const entries = Array.isArray(raw) ? raw : [raw]
  const out: ExtensionConfig[] = []
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue
    // Seanime manifests carry the module URL in `payloadURI` (a full https URL), not `code`/`main`.
    const codeSpec = e.code ?? e.main ?? e.payloadURI
    if (!codeSpec) continue
    if (e.type && e.type !== 'torrent' && e.type !== 'onlinestream-provider' && e.type !== 'anime-torrent-provider') continue
    out.push({
      id: String(e.id ?? e.name ?? codeSpec),
      name: String(e.name ?? e.id ?? 'Extension'),
      version: e.version,
      type: e.type,
      code: e.payloadURI ? String(e.payloadURI) : resolveCodeUrl(e, manifestUrl),
      icon: e.icon,
      description: e.description,
      settings: e.settings,
    })
  }
  return out
}

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
  if (depth === 0 && entries.length > 0 && entries.every(isRepoPointer)) {
    const nested = await Promise.all(entries.map((e) => expandManifest(String(e.main ?? e.url), depth + 1).catch(() => [])))
    return nested.flat()
  }
  return normalizeManifest(raw, url)
}

/** Fetch + expand a single stored spec for display (name/icon/version) in the
 *  settings list. Best-effort: [] on failure. */
export async function fetchExtensionMeta(spec: string): Promise<ExtensionConfig[]> {
  try { return await expandManifest(spec) } catch { return [] }
}

async function loadConfigs(): Promise<ExtensionConfig[]> {
  const all: ExtensionConfig[] = []
  for (const spec of get(enabledExtensionUrls)) {
    try { all.push(...await expandManifest(spec)) } catch { /* skip bad manifest */ }
  }
  return all
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
        const r = await invoke<{ status: number; headers: Record<string, string>; body: string }>('ext_fetch', {
          url: m.url,
          method: init.method,
          headers: init.headers,
          body: typeof init.body === 'string' ? init.body : undefined,
        })
        worker.postMessage({ type: 'fetch-result', reqId: m.reqId, res: { ok: r.status >= 200 && r.status < 300, status: r.status, headers: r.headers, body: r.body } })
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
    worker.postMessage({ type: 'load', id, code, settings: cfg.settings, kind: cfg.type === 'onlinestream-provider' ? 'seanime' : cfg.type === 'anime-torrent-provider' ? 'atp' : undefined })
  })
  return ext
}

// In-flight build so concurrent callers (torrent wave + streaming wave in the same play) share ONE
// build instead of one racing ahead and reading a half-built `running`. `running`/`builtFrom` are
// published only AFTER the build completes.
let buildPromise: Promise<RunningExt[]> | null = null
async function ensureRunning(): Promise<RunningExt[]> {
  const key = JSON.stringify(get(enabledExtensionUrls))
  if (running && builtFrom === key) return running
  if (buildPromise) return buildPromise
  buildPromise = (async () => {
    running?.forEach((e) => e.worker.terminate())
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
export async function queryExtensions(query: TorrentQuery, onBatch?: (rs: TorrentResult[]) => void): Promise<TorrentResult[]> {
  try {
    if (!get(enabledExtensionUrls).length) return []
    const exts = await ensureRunning()
    const live = (await Promise.all(exts.map(async (e) => ((await e.ready) ? e : null)))).filter(Boolean) as RunningExt[]
    // Movies also get single(): SDK sources treat single() as the universal entry (their movie()
    // often returns [] with "single already gets movies with matching media id").
    const methods = query.episode != null ? ['single', 'batch'] : ['single', 'movie']
    // Stamp each result with the extension that produced it (name + icon), mirroring the
    // torrent-provider path, so the picker labels the row with the real source instead of the
    // generic "Extension" fallback. Per-extension map (not a flat fan-out) keeps that association.
    const batches = await Promise.all(live.map(async (e) => {
      const rs = (await Promise.all(methods.map((m) => call(e, m, query)))).flat()
      const stamped = rs.map((r) => ({ ...r, provider: r.provider ?? e.cfg.name, logo: r.logo ?? e.cfg.icon }))
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
export async function runningStreamExtensions(): Promise<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { id: string; name: string; call: (method: string, ...args: unknown[]) => Promise<any> }[]
> {
  if (!get(enabledExtensionUrls).length) return []
  const exts = await ensureRunning()
  const live = (await Promise.all(
    exts.map(async (e) => ((await e.ready) && e.cfg.type === 'onlinestream-provider' ? e : null)),
  )).filter(Boolean) as RunningExt[]
  return live.map((e) => ({ id: e.cfg.id, name: e.cfg.name, call: (method: string, ...args: unknown[]) => callRaw(e, method, args) }))
}

/** The live anime-torrent-provider extensions, each with a bound multi-arg `call`.
 *  torrentProvider.queryTorrentProviders drives search/smartSearch through it. */
export async function runningTorrentProviderExtensions(): Promise<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { id: string; name: string; icon?: string; call: (method: string, ...args: unknown[]) => Promise<any> }[]
> {
  if (!get(enabledExtensionUrls).length) return []
  const exts = await ensureRunning()
  const live = (await Promise.all(
    exts.map(async (e) => ((await e.ready) && e.cfg.type === 'anime-torrent-provider' ? e : null)),
  )).filter(Boolean) as RunningExt[]
  return live.map((e) => ({ id: e.cfg.id, name: e.cfg.name, icon: e.cfg.icon, call: (method: string, ...args: unknown[]) => callRaw(e, method, args) }))
}
