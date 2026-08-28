import { invoke } from '@tauri-apps/api/core'
import { get } from 'svelte/store'
import { invokeNativeHttp, isNativeTransportFailure, phttp } from '$lib/net/http'
import { enabledExtensionUrls, disabledPlugins } from '$lib/settings/ui'
import type { TorrentResult, TorrentQuery, ExtensionConfig } from './types'
import { resolveManifestUrl, normalizeManifest, pointerUrl, isRunnableType, isLegacyTorrentType, manifestProblem, catalogPackages } from './catalog'
import type { ExtensionCatalogPackage } from './catalog'
import { extensionSourceConfigured, liveJvmSources } from './availability'
import { clearProviderCache } from '$lib/stremio/online-cache'
import { dedupeJvmSources, isJvmHostedVideoUrl, normalizeJvmSidecarUrl, parseJvmVideoTitle } from './jvm-video'
import { trackFetch, fetchEpoch } from './fetch-registry'
import { currentResolveTrace, traceResolve } from '$lib/debug/resolve-trace'
import { afterExtensionReady, settleExtensionMethods } from './method-stream'
import { loadCachedExtensionModule } from './module-cache'
import { extensionSourceScheduler } from './source-scheduler'

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
let emptyBuildAt = 0
let installedRevision = 0
let buildGeneration = 0

export interface InstalledExtensionPackage {
  id: string
  name: string
  version: string
  lang?: string
  description?: string
  code?: string
  backend: 'izumi-js' | 'aniyomi-jvm' | 'izumi-service'
  sourceId: string
  sourceIds: string[]
  signed: boolean
  serviceEntry?: string
}

export interface JvmSourceFilter {
  name: string
  type: 'Header' | 'Separator' | 'CheckBox' | 'TriState' | 'Select' | 'Group' | 'Sort' | 'Text' | 'Unknown'
  state: unknown
  values?: string[] | null
}

export interface JvmSourcePreference {
  key: string
  title?: string | null
  summary?: string | null
  enabled?: boolean
  type: 'list' | 'multi_select' | 'switch' | 'checkbox' | 'text' | 'other'
  value: unknown
  entries?: string[] | null
  entryValues?: string[] | null
}

export type { ExtensionCatalogPackage, ExtensionCatalog } from './catalog'

/** The maintained anime/HTTP package catalog used by the built-in Source Store. It can also appear
 *  in the user's source list like any other package catalog. Kept here as the canonical address of
 *  the repository the packages are published to. */
export const OFFICIAL_ANIME_CATALOG =
  'https://raw.githubusercontent.com/nickEatsBread/izumi-extension-repo/refs/heads/main/index.json'

interface JvmSource {
  id: string
  name: string
  lang?: string
  type: 'anime' | 'manga'
  baseUrl?: string
  pkgName: string
  className?: string
  supportsLatest?: boolean
  supportsPopular?: boolean
  /** The extension APK's launcher icon as base64 PNG. The bridge extracts it to a file and returns
   *  a path; the Rust command inlines it (see inline_source_icons) because a webview cannot load a
   *  bare filesystem path. Null when the extension has no readable icon. */
  iconUrl?: string | null
}

function resetRunning(): void {
  running?.forEach((extension) => extension.worker.terminate())
  running = null
  builtFrom = ''
  emptyBuildAt = 0
  buildPromise = null
  buildGeneration += 1
  clearProviderCache()
}

// One listing per install-set: `extension_list` re-reads, unzips, SHA-256s and signature-verifies
// EVERY installed `.izumi-ext` on each call, and the resolve path hits it several times per episode
// click (guard, build, JVM enumeration, source origins). The installed set only changes when a
// package is added or removed — both of which bump `installedRevision` (finishPackageInstall,
// removeInstalledExtension) — so that counter is the exact invalidation key. The PROMISE is cached,
// not the resolved array, so callers that fire concurrently share one invoke instead of racing
// several full verification passes.
let installedPackagesCache: { revision: number; value: Promise<InstalledExtensionPackage[]> } | null = null

export async function installedExtensionPackages(): Promise<InstalledExtensionPackage[]> {
  if (installedPackagesCache?.revision === installedRevision) return installedPackagesCache.value
  // Explicit annotation: without it TS reports circular inference on the self-reference below.
  const entry: { revision: number; value: Promise<InstalledExtensionPackage[]> } = {
    revision: installedRevision,
    // A failure must not be remembered as "no packages installed" for the rest of the revision —
    // drop the slot so the next caller retries the invoke.
    value: invoke<InstalledExtensionPackage[]>('extension_list').catch(() => {
      if (installedPackagesCache === entry) installedPackagesCache = null
      return [] as InstalledExtensionPackage[]
    }),
  }
  installedPackagesCache = entry
  return entry.value
}

export async function installCatalogPackage(
  extension: Pick<ExtensionCatalogPackage, 'package' | 'packageSha256'>,
): Promise<InstalledExtensionPackage> {
  const installed = await invoke<InstalledExtensionPackage>('extension_install_url', {
    url: extension.package,
    expectedSha256: extension.packageSha256,
  })
  return finishPackageInstall(installed)
}

async function finishPackageInstall(installed: InstalledExtensionPackage): Promise<InstalledExtensionPackage> {
  if (installed.backend === 'aniyomi-jvm') {
    await invoke('jvm_extension_reload').catch(() => {})
  }
  if (installed.backend === 'izumi-service') {
    await invoke('extension_service_stop', { id: installed.id }).catch(() => {})
  }
  installedRevision += 1
  resetRunning()
  return installed
}

export async function removeInstalledExtension(id: string): Promise<void> {
  await invoke('extension_service_stop', { id }).catch(() => {})
  await invoke('extension_remove', { id })
  await invoke('jvm_extension_reload').catch(() => {})
  installedRevision += 1
  resetRunning()
}

/** Fast configuration guard for playback. Unlike checking extension URLs, this
 * also sees enabled `.izumi-ext` packages stored by the desktop installer. */
export async function hasConfiguredExtensions(): Promise<boolean> {
  const manifests = get(enabledExtensionUrls)
  if (manifests.length) return true
  return extensionSourceConfigured(
    manifests,
    await installedExtensionPackages(),
    get(disabledPlugins),
  )
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
  return expandRaw(await r.json(), url, depth)
}

// Split from the fetch above so the settings list can classify a document (package catalog vs
// manifest) and still expand it without paying a SECOND round-trip for the same URL.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function expandRaw(raw: any, url: string, depth = 0): Promise<ExtensionConfig[]> {
  // A package catalog runs nothing itself: its entries are `.izumi-ext` downloads, and the
  // INSTALLED copies are what loadConfigs picks up. Stop here so a catalog URL sitting in the
  // source list can't be mistaken for a manifest that produced no extensions.
  if (catalogPackages(raw)) return []
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

export interface ExtensionSourceInfo {
  /** Extensions izumi runs straight from the network. Empty for a package catalog. */
  configs: ExtensionConfig[]
  /** Present when the URL is a package catalog — the installable `.izumi-ext` payloads it lists. */
  packages?: ExtensionCatalogPackage[]
  /** Why neither of the above came back, in words a user can act on. */
  problem?: string
}

/** What a stored source spec actually is, for the settings list: a manifest of runnable
 *  extensions, a catalog of installable packages, or a reason it is neither. One fetch answers
 *  all three — the old two-pass version re-fetched the same URL to explain a failure. */
export async function fetchExtensionInfo(spec: string): Promise<ExtensionSourceInfo> {
  const url = resolveManifestUrl(spec)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let raw: any
  try {
    const r = await phttp(url)
    if (!r.ok) return { configs: [], problem: `That URL returned HTTP ${r.status}.` }
    raw = await r.json()
  } catch {
    return { configs: [], problem: 'That URL could not be fetched.' }
  }
  const packages = catalogPackages(raw)
  if (packages) return { configs: [], packages }
  const configs = await expandRaw(raw, url).catch(() => [] as ExtensionConfig[])
  // Say so out loud when a source can never work (a compiled Android plugin repo, say), rather
  // than showing an empty list that reads as izumi being broken.
  return configs.length ? { configs } : { configs, problem: manifestProblem(raw) }
}

async function loadConfigs(): Promise<ExtensionConfig[]> {
  // Each spec is an independent network fetch, so awaiting them one at a time made warm-up cost the
  // SUM of every manifest round-trip. Order is preserved by Promise.all, and a bad manifest still
  // degrades to [] on its own without taking the others down.
  const [results, installed] = await Promise.all([
    Promise.all(
    get(enabledExtensionUrls).map((spec) =>
      expandManifest(spec).catch(() => [] as ExtensionConfig[])),
    ),
    installedExtensionPackages(),
  ])
  // A source URL expands to many plugins; drop the ones switched off individually. Filtered HERE
  // rather than at query time so a disabled plugin never has its module fetched or a worker spawned.
  const off = get(disabledPlugins)
  const services = await Promise.all(installed
    .filter((extension) => extension.backend === 'izumi-service')
    .map(async (extension) => {
      if (off.includes(extension.id)) {
        await invoke('extension_service_stop', { id: extension.id }).catch(() => {})
        return [] as ExtensionConfig[]
      }
      try {
        const manifest = await invoke<string>('extension_service_ensure', { id: extension.id })
        return await expandManifest(manifest)
      } catch (error) {
        console.warn(`[extensions] local service failed to start: ${extension.name} (${extension.id})`, error)
        return [] as ExtensionConfig[]
      }
    }))
  const local = installed
    .filter((extension) => extension.backend === 'izumi-js' && !!extension.code)
    .map((extension): ExtensionConfig => ({
    id: extension.id,
    name: extension.name,
    version: extension.version,
    type: 'onlinestream-provider',
    code: `installed:${extension.id}`,
    description: extension.description,
    lang: extension.lang,
    runtime: 'izumi-js',
    moduleCode: extension.code!,
    signed: extension.signed,
  }))
  const seen = new Set<string>()
  return [...results.flat(), ...services.flat(), ...local].filter((config) => {
    if (off.includes(config.id) || seen.has(config.id)) return false
    // The same marketplace can be installed through both its catalog URL and an expanded pointer,
    // and two catalogs may contain the same provider. One worker per stable id prevents duplicate
    // Nyaa/Sukebei requests and duplicated picker rows without conflating different providers that
    // merely share a display name.
    seen.add(config.id)
    return true
  })
}

// Fetch an extension's module source. esm.sh often returns a tiny re-export STUB
// pointing at the hashed build (`export * from "/gh/…"`); a blob import of that text
// can't resolve the relative target, so follow it once to the real module.
async function fetchRemoteModuleCode(url: string): Promise<string | null> {
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
      // Registered with the fetch registry so a source pick can abort it MID-FLIGHT: the worker
      // code that issued this fetch is unreachable from the host, and an unaborted ext_fetch holds
      // a native lane permit for up to 30s — exactly the lanes the picked source now needs.
      const tracked = trackFetch()
      try {
        const init = m.init ?? {}
        const args = {
          url: m.url,
          method: init.method,
          headers: init.headers,
          body: typeof init.body === 'string' ? init.body : undefined,
        }
        const fetchOnce = () => invokeNativeHttp<{ status: number; url: string; headers: Record<string, string>; setCookie: string[]; body: string }>(
          'ext_fetch', args, { signal: tracked.controller.signal })
        let r: Awaited<ReturnType<typeof fetchOnce>>
        try {
          r = await fetchOnce()
        } catch (error) {
          const method = String(init.method ?? 'GET').toUpperCase()
          // Source GETs are idempotent and frequently sit behind free indexer/CDN DNS. Give a
          // transient native transport failure one fresh attempt. Never replay a POST or an abort.
          if (tracked.controller.signal.aborted || !['GET', 'HEAD'].includes(method) || !isNativeTransportFailure(error)) throw error
          r = await fetchOnce()
        }
        worker.postMessage({ type: 'fetch-result', reqId: m.reqId, res: { ok: r.status >= 200 && r.status < 300, status: r.status, url: r.url, headers: r.headers, setCookie: r.setCookie, body: r.body } })
      } catch (err) {
        worker.postMessage({ type: 'fetch-result', reqId: m.reqId, error: String(err) })
      } finally {
        tracked.done()
      }
    } else if (m.type === 'loaded' || m.type === 'result') {
      const w = ext.waits.get(m.id)
      if (w) { ext.waits.delete(m.id); w(m) }
    }
  }
  ext.ready = new Promise<boolean>((resolve) => {
    const id = ++ext.seq
    // A wedged worker (e.g. a shim module-eval error before onmessage is wired) must eventually
    // leave its own provider task. Siblings no longer wait for it, but the overall resolve still
    // needs this 20s backstop before it can report that every provider has settled.
    const t = setTimeout(() => { ext.waits.delete(id); resolve(false) }, 20000)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ext.waits.set(id, (m: any) => { clearTimeout(t); resolve(!m.error) })
    worker.onerror = () => { clearTimeout(t); ext.waits.delete(id); resolve(false) }
    // `name` rides along so host-side helpers running inside the worker (the embed extractors) can
    // attribute what they resolve back to the extension that asked, instead of returning anonymous
    // links the picker then has to label generically.
    worker.postMessage({
      type: 'load',
      id,
      code,
      name: cfg.name,
      settings: cfg.settings,
      kind: cfg.runtime === 'izumi-js'
        ? 'izumi'
        : cfg.type === 'onlinestream-provider'
          ? 'seanime'
          : cfg.type === 'anime-torrent-provider'
            ? 'atp'
            : undefined,
    })
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
  const key = JSON.stringify([get(enabledExtensionUrls), get(disabledPlugins), installedRevision])
  // Do not remember a transient all-failed build forever. A local or remote provider may become
  // ready just after warmExtensions(); caching [] for the whole app session would prevent retry.
  if (running && builtFrom === key && (running.length > 0 || Date.now() - emptyBuildAt < 1_000)) return running
  if (buildPromise) return buildPromise
  const generation = buildGeneration
  const promise = (async () => {
    running?.forEach((e) => e.worker.terminate())
    // The resolver memoizes each provider's search/episode/settings answers. Those belong to the
    // PREVIOUS set of workers, so a provider that was just enabled, disabled or updated must not
    // keep serving results from its old incarnation.
    clearProviderCache()
    // Fetch every module in parallel — sequentially this was N × (esm.sh latency), the bulk of the
    // first-resolve stall for multi-source repos.
    const cfgs = await loadConfigs()
    const codes = await Promise.all(cfgs.map(async (cfg) => {
      try {
        return {
          cfg,
          code: cfg.moduleCode ?? await loadCachedExtensionModule(
            cfg,
            () => fetchRemoteModuleCode(cfg.code),
          ),
        }
      } catch (error) {
        console.warn(`[extensions] failed to load ${cfg.name} (${cfg.id})`, error)
        return { cfg, code: null }
      }
    }))
    const next: RunningExt[] = []
    for (const { cfg, code } of codes) if (code) next.push(spawn(cfg, code))
    if (generation !== buildGeneration) {
      next.forEach((extension) => extension.worker.terminate())
      return []
    }
    running = next
    builtFrom = key
    emptyBuildAt = next.length ? 0 : Date.now()
    return next
  })()
  buildPromise = promise
  try { return await promise }
  finally { if (buildPromise === promise) buildPromise = null }
}

/** How many extensions will actually be queried. NOT the URL count — one source URL expands to many
 *  plugins (a marketplace index yields ~18), so only this can answer "is there exactly one source?". */
export async function runningExtensionCount(): Promise<number> {
  return (await ensureRunning()).length
}

/** Pre-boot both extension runtimes off the click-to-play path. On a clean macOS install, Java
 *  discovery plus the private JRE download/extract can take most of the resolver's startup budget;
 *  leaving JVM packages out of this warm made the first Play look as if no source were installed. */
export async function warmExtensions(): Promise<void> {
  // Do not make the WebView parse JS workers while a clean-install JVM runtime is also being
  // discovered/downloaded/extracted. Foreground resolvers still share either in-flight promise.
  await ensureRunning().then(() => {}, () => {})
  await warmJvmExtensions()
}

/** Warm only the installed Aniyomi runtime. Catalog Home schedules this ahead of the broader JS
 * extension warm so switching providers does not begin Java discovery from a cold start. */
export async function warmJvmExtensions(): Promise<void> {
  await runningJvmExtensions().then(() => {}, () => {})
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
export async function queryExtensions(query: TorrentQuery, onBatch?: (rs: TorrentResult[]) => void, onlyId?: string, signal?: AbortSignal): Promise<TorrentResult[]> {
  try {
    const trace = currentResolveTrace(query.anilistId, query.episode)
    const exts = await ensureRunning()
    const torrentExts = exts.filter((e) => isLegacyTorrentType(e.cfg.type))
    const candidates = torrentExts.filter((e) => !onlyId || e.cfg.id === onlyId)
    // Movies also get single(): SDK sources treat single() as the universal entry (their movie()
    // often returns [] with "single already gets movies with matching media id").
    const methods = query.episode != null ? ['single', 'batch'] : ['single', 'movie']
    traceResolve(trace, 'legacy torrent extensions ready', {
      configured: torrentExts.length,
      candidates: candidates.length,
      methods,
    })
    // Stamp each result with the extension that produced it (name + icon), mirroring the
    // torrent-provider path, so the picker labels the row with the real source instead of the
    // generic "Extension" fallback. Per-extension map (not a flat fan-out) keeps that association.
    const batches = await Promise.all(candidates.map(async (e) => {
      // Await only THIS worker. A broken worker may consume its 20s cap, but a sibling that loaded
      // in 200ms can already query and release rows through onBatch.
      if (!await e.ready) return []
      return extensionSourceScheduler.run(`torrent:${e.cfg.id}`, async () => {
        const providerStartedAt = performance.now()
        traceResolve(trace, 'legacy torrent provider start', { provider: e.cfg.name })
        // A superseded resolve (source already picked) must not issue further worker queries — each
        // one spawns HTTP that competes with the picked source's playback path.
        const queried = await settleExtensionMethods(methods, async (method) => {
          const methodStartedAt = performance.now()
          traceResolve(trace, 'legacy torrent provider method start', { provider: e.cfg.name, method })
          const results = signal?.aborted ? [] : await call(e, method, query)
          traceResolve(trace, 'legacy torrent provider method finish', {
            provider: e.cfg.name,
            method,
            durationMs: Math.round(performance.now() - methodStartedAt),
            rows: results.length,
          })
          return results.map((result, upstreamRank) => ({
            ...(method === 'batch' && result.type == null ? { ...result, type: 'batch' as const } : result),
            evidence: {
              ...(result.evidence ?? {}),
              upstreamRank: result.evidence?.upstreamRank ?? upstreamRank,
            },
            provider: result.provider ?? e.cfg.name,
            providerId: e.cfg.id,
            logo: result.logo ?? e.cfg.icon,
          }))
        }, (_method, results) => {
          // Treat single() and batch() as independent tasks: an episode lookup must not sit hidden
          // behind a slow season-pack query.
          if (onBatch && results.length) onBatch(results)
        })
        // Preserve which SDK method produced the row. A lot of Blu-ray packs are named only
        // "[Group] Title (BD 1080p)" with no textual batch marker, so losing `batch()` here made
        // refinement label them "movie, not an episode". If single() and batch() return the same
        // hash, merge the structural batch fact before the incremental callback sees it.
        const byHash = new Map<string, TorrentResult>()
        const noHash: TorrentResult[] = []
        for (const { result: results } of queried) {
          for (const result of results) {
            const next = result
            if (!next.hash) {
              noHash.push(next)
              continue
            }
            const previous = byHash.get(next.hash)
            if (!previous) {
              byHash.set(next.hash, next)
            } else if (next.type === 'batch' && previous.type !== 'batch') {
              byHash.set(next.hash, { ...previous, type: 'batch' })
            }
          }
        }
        const stamped = [...byHash.values(), ...noHash]
        traceResolve(trace, 'legacy torrent provider finish', {
          provider: e.cfg.name,
          durationMs: Math.round(performance.now() - providerStartedAt),
          rows: stamped.length,
        })
        return stamped
      })
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
  const [exts, jvm] = await Promise.all([ensureRunning(), runningJvmExtensions(onlyId)])
  const candidates = exts.filter((e) =>
    (!onlyId || e.cfg.id === onlyId) && e.cfg.type === 'onlinestream-provider')
  return [
    ...candidates.map((e) => ({
      id: e.cfg.id,
      name: e.cfg.name,
      lang: e.cfg.lang,
      call: afterExtensionReady(
        e.ready,
        (method: string, ...args: unknown[]) => callRaw(e, method, args),
        null,
      ),
    })),
    ...jvm,
  ]
}

function episodeNumber(value: { episode_number?: unknown; name?: unknown }): number {
  const direct = Number(value.episode_number)
  if (Number.isFinite(direct) && direct >= 0) return direct
  const parsed = String(value.name ?? '').match(/(?:episode|ep\.?|e)\s*(\d+(?:\.\d+)?)/i)?.[1]
    ?? String(value.name ?? '').match(/(\d+(?:\.\d+)?)/)?.[1]
  return Number.parseFloat(parsed ?? '')
}

function mediaType(url: string, label = ''): 'm3u8' | 'dash' | 'mp4' {
  // Some JVM sources wrap a manifest in a localhost URL whose path no longer ends in `.m3u8`
  // so an in-process bridge can preprocess each segment. The Video quality still says "(HLS)",
  // so keep that signal instead of misclassifying the wrapper as MP4.
  if (/\bhls\b/i.test(label)) return 'm3u8'
  if (/\.m3u8(?:[?#]|$)/i.test(url)) return 'm3u8'
  if (/\.mpd(?:[?#]|$)/i.test(url)) return 'dash'
  return 'mp4'
}

// Every other extension path caps its calls at 20s; the JVM bridge had NO cap at any layer, so a
// wedged extension network call held the resolve open forever (the "stuck on Preparing download"
// report). The native side has its own deadlines now; this race keeps the UI honest even if a
// bridge response goes missing entirely.
const JVM_CALL_TIMEOUT_MS = 20_000
function jvmRequestId(): string {
  return `izumi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function jvmInvoke<T>(method: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const requestId = jvmRequestId()
  return new Promise<T>((resolve, reject) => {
    let finished = false
    let timer: ReturnType<typeof setTimeout>
    const finish = (action: () => void) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      action()
    }
    const cancel = () => { void invoke('jvm_extension_cancel', { requestId }).catch(() => {}) }
    const abort = () => finish(() => {
      cancel()
      reject(new DOMException('Aborted', 'AbortError'))
    })
    timer = setTimeout(() => finish(() => {
      cancel()
      reject(new Error(`The extension did not answer in time (${method}).`))
    }), JVM_CALL_TIMEOUT_MS)
    if (signal?.aborted) {
      abort()
      return
    }
    signal?.addEventListener('abort', abort, { once: true })
    invoke<T>('jvm_extension_call', { method, args, requestId }).then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    )
  })
}

async function jvmProviderCall(source: JvmSource, method: string, callArgs: unknown[]): Promise<unknown> {
  // A bridge call cannot be cancelled mid-flight (the JVM side has no abort channel), so
  // cancellation is epoch-based: picking a source bumps the fetch epoch, and this guard throws
  // an AbortError — before the invoke when the pick already happened, and after it when the pick
  // landed DURING the wait — so the resolver never spends the next hop (getDetail, getVideoList)
  // on a resolve that has been superseded. noteProblem upstream swallows AbortError, so a
  // cancelled provider stays silent in the picker instead of reporting a fake failure.
  const startEpoch = fetchEpoch()
  const guard = () => {
    if (fetchEpoch() !== startEpoch) throw new DOMException('Aborted', 'AbortError')
  }
  if (method === 'getSettings') {
    // JVM getVideoList already returns every server and audio flavour in one response. Marking this
    // prevents the online layer from issuing identical sub + dub calls (and starting two competing
    // provider localhost servers) while still allowing its per-video title to carry SUB/DUB.
    return { episodeServers: ['default'], returnsMixedAudio: true }
  }
  if (method === 'search') {
    const input = (callArgs[0] ?? {}) as { query?: unknown }
    guard()
    const response = await jvmInvoke<{ list?: Record<string, unknown>[] }>('search', {
      sourceId: source.id, query: String(input.query ?? ''), page: 1, isAnime: true,
    })
    guard()
    return (response.list ?? []).map((item) => ({
      id: JSON.stringify({ url: item.url, title: item.title, cover: item.cover ?? item.thumbnail_url }),
      title: String(item.title ?? ''),
      url: String(item.url ?? ''),
    }))
  }
  if (method === 'findEpisodes') {
    const identity = JSON.parse(String(callArgs[0] ?? '{}')) as { url?: string; title?: string; cover?: string }
    guard()
    const detail = await jvmInvoke<{ title?: unknown; episodes?: Record<string, unknown>[] }>('getDetail', {
      sourceId: source.id,
      media: {
        url: identity.url ?? '',
        title: identity.title ?? '',
        thumbnail_url: identity.cover ?? '',
      },
      isAnime: true,
    })
    guard()
    return (detail.episodes ?? [])
      .map((episode) => ({
        id: JSON.stringify({
          url: episode.url,
          name: episode.name,
          episode_number: episode.episode_number,
          scanlator: episode.scanlator,
          date_upload: episode.date_upload,
          fillermark: episode.fillermark,
          summary: episode.summary,
          preview_url: episode.preview_url,
        }),
        number: episodeNumber(episode),
        title: String(episode.name ?? ''),
        url: String(episode.url ?? ''),
        overview: String(episode.summary ?? '') || undefined,
        thumbnail: String(episode.preview_url ?? '') || undefined,
        filler: episode.fillermark === true,
        group: String(episode.scanlator ?? '') || undefined,
        // Keep the detail page's canonical identity attached through episode resolution. Search
        // pages can be fuzzy or redirect; the online resolver revalidates this before fetching video.
        sourceTitle: String(detail.title ?? identity.title ?? ''),
      }))
      .filter((episode) => Number.isFinite(episode.number))
  }
  if (method === 'findEpisodeServer') {
    const raw = callArgs[0] as { id?: unknown } | string
    const encoded = typeof raw === 'string' ? raw : raw?.id
    const episode = JSON.parse(String(encoded ?? '{}')) as Record<string, unknown>
    guard()
    const videos = await jvmInvoke<Record<string, unknown>[]>('getVideoList', {
      sourceId: source.id,
      episode,
    })
    guard()
    const mapped = videos
      .filter((video) => /^https?:\/\//i.test(String(video.url ?? '')))
      .map((video) => {
        const url = String(video.url)
        const identity = parseJvmVideoTitle(video.title)
        const subtitles = ((video.subtitles ?? []) as Record<string, unknown>[])
          .flatMap((track) => {
            const url = normalizeJvmSidecarUrl(track.file ?? track.url)
            return url ? [{
              url,
              language: String(track.label ?? track.language ?? ''),
              isDefault: Boolean(track.isDefault ?? track.default ?? false),
              headers: (track.headers ?? undefined) as Record<string, string> | undefined,
            }] : []
          })
        return {
          url,
          // The upstream Aniyomi HttpServer binds all interfaces but reports localhost. Watch
          // Together may advertise this specific server over the host LAN; do not infer the same
          // thing later for Izumi's own loopback-only media proxies.
          localServer: isJvmHostedVideoUrl(url),
          type: mediaType(url, `${String(video.quality ?? '')} ${String(video.title ?? '')}`),
          quality: String(video.quality ?? identity.quality ?? video.title ?? 'auto'),
          server: identity.server,
          audio: identity.audio,
          subtitleMode: identity.subtitleMode === 'hard'
            ? 'hard'
            : subtitles.length ? 'soft' : undefined,
          headers: (video.headers ?? {}) as Record<string, string>,
          bitrate: Number(video.bitrate) || undefined,
          preferred: video.preferred === true,
          timestamps: Array.isArray(video.timestamps) ? video.timestamps : [],
          mpvArgs: (video.mpvArgs ?? {}) as Record<string, string>,
          ffmpegStreamArgs: (video.ffmpegStreamArgs ?? {}) as Record<string, string>,
          ffmpegVideoArgs: (video.ffmpegVideoArgs ?? {}) as Record<string, string>,
          internalData: video.internalData,
          initialized: video.initialized === true,
          subtitles,
          audioTracks: ((video.audios ?? []) as Record<string, unknown>[])
            .flatMap((track) => {
              const url = normalizeJvmSidecarUrl(track.file ?? track.url)
              return url ? [{
                url,
                language: String(track.label ?? track.language ?? ''),
                title: String(track.title ?? track.label ?? ''),
                headers: (track.headers ?? undefined) as Record<string, string> | undefined,
              }] : []
            }),
        }
      })
    return {
      server: source.name,
      headers: {},
      videoSources: mapped,
    }
  }
  return null
}

// One enumeration per install-set: `jvm_extension_sources` spins the whole Java runtime up, and it
// was re-invoked on EVERY resolve (every episode transition paid it — and its Rust budget allows
// minutes when the runtime APK needs re-downloading). The source list only changes when a package
// is (un)installed, which is exactly what `installedRevision` counts.
let jvmSourcesCache: { revision: number; sources: JvmSource[] } | null = null
let jvmSourcesPending: { revision: number; value: Promise<JvmSource[]> } | null = null

/** Installed Aniyomi extension icons, keyed by ANDROID PACKAGE NAME — which is exactly the `id` a
 *  catalog entry carries for an aniyomi-jvm package, so the settings list can match them directly.
 *  Android reads the launcher icon through its bridge; desktop recovers it from the packaged APK.
 *  Any failure (no JVM runtime, no sources, a slow bridge) yields an empty map and the UI falls back
 *  to the shared placeholder. Never spins the runtime on its own — it reuses the enumeration cache
 *  when one exists and otherwise pays the same capped call a resolve would. */
export async function jvmExtensionIcons(): Promise<Map<string, string>> {
  const icons = new Map<string, string>()
  try {
    const installed = await installedExtensionPackages()
    if (!installed.some((p) => p.backend === 'aniyomi-jvm')) return icons
    const sources = await jvmSources()
    for (const source of sources) {
      if (source.pkgName && source.iconUrl) icons.set(source.pkgName, source.iconUrl)
    }
  } catch { /* best-effort — the placeholder fallback covers it */ }
  return icons
}

export async function ensureExtensionService(id: string): Promise<string> {
  return invoke<string>('extension_service_ensure', { id })
}

export type ServiceSettingValue = string | number | boolean | null
export interface ServiceSettingCondition {
  key: string
  equals: ServiceSettingValue | ServiceSettingValue[]
}

export interface JvmCatalogSource {
  id: string
  name: string
  lang?: string
  icon?: string
  supportsLatest: boolean
  supportsPopular: boolean
}

export interface JvmCatalogPageResult {
  list: Record<string, unknown>[]
  hasNextPage: boolean
}
export interface ServiceSettingOption {
  value: string
  label: string
  description?: string
  submitLabel?: string
  submittingLabel?: string
  intent?: 'primary' | 'danger'
  hideSubmit?: boolean
}
export interface ServiceSettingField {
  key: string
  label: string
  description?: string
  type: 'text' | 'password' | 'number' | 'boolean' | 'select'
  role?: 'action'
  visibleWhen?: ServiceSettingCondition
  required?: boolean
  placeholder?: string
  min?: number
  max?: number
  step?: number
  options?: ServiceSettingOption[]
}
export interface ServiceSettingsNotice {
  tone: 'info' | 'success' | 'warning' | 'error'
  title?: string
  message: string
  code?: string
  action?: { label: string; url: string }
  visibleWhen?: ServiceSettingCondition
}
export interface ServiceSettingsDocument {
  version: 1
  title?: string
  description?: string
  submitLabel?: string
  submittingLabel?: string
  notice?: ServiceSettingsNotice
  refreshAfterMs?: number
  fields: ServiceSettingField[]
  values: Record<string, ServiceSettingValue>
}
export interface ServiceSettingsSaveResult {
  ok?: boolean
  message?: string
  restartRequired?: boolean
  version?: 1
  title?: string
  description?: string
  submitLabel?: string
  submittingLabel?: string
  notice?: ServiceSettingsNotice
  refreshAfterMs?: number
  fields?: ServiceSettingField[]
  values?: Record<string, ServiceSettingValue>
}

export async function extensionServiceSettings(id: string): Promise<ServiceSettingsDocument> {
  const value = await invoke<ServiceSettingsDocument>('extension_service_settings', { id })
  if (value?.version !== 1 || !Array.isArray(value.fields) || !value.values || typeof value.values !== 'object') {
    throw new Error('This local service returned an unsupported settings schema.')
  }
  return value
}

export function saveExtensionServiceSettings(
  id: string,
  values: Record<string, ServiceSettingValue>,
): Promise<ServiceSettingsSaveResult> {
  return invoke<ServiceSettingsSaveResult>('extension_service_settings_save', { id, values })
}

/** Icons for installed packages: Aniyomi launcher artwork plus the live manifest icon of a
 *  local-service package. Best-effort; missing entries fall through to the shared placeholder. */
export async function installedPackageIcons(
  packages: InstalledExtensionPackage[] = [],
): Promise<Map<string, string>> {
  const icons = await jvmExtensionIcons()
  await Promise.all(packages
    .filter((extension) => extension.backend === 'izumi-service')
    .map(async (extension) => {
      try {
        const manifestUrl = await ensureExtensionService(extension.id)
        const info = await fetchExtensionInfo(manifestUrl)
        const icon = info.configs[0]?.icon
        if (icon) icons.set(extension.id, icon)
      } catch { /* placeholder remains */ }
    }))
  return icons
}

/** The enumeration itself, memoized per install revision (see jvmSourcesCache). */
async function jvmSources(): Promise<JvmSource[]> {
  if (jvmSourcesCache?.revision === installedRevision) return jvmSourcesCache.sources
  const revision = installedRevision
  if (jvmSourcesPending?.revision !== revision) {
    const entry = {
      revision,
      value: invoke<JvmSource[]>('jvm_extension_sources'),
    }
    // Keep the native initialization alive after a caller's UI deadline. Its eventual result warms
    // the next resolve instead of being discarded and followed by another full JVM enumeration.
    entry.value = entry.value.then(
      (sources) => {
        if (installedRevision === revision) jvmSourcesCache = { revision, sources }
        if (jvmSourcesPending === entry) jvmSourcesPending = null
        return sources
      },
      (error) => {
        if (jvmSourcesPending === entry) jvmSourcesPending = null
        throw error
      },
    )
    jvmSourcesPending = entry
  }
  // The last uncapped jvm* await the UI sat behind: the Rust side legally takes ~190s worst case
  // (runtime download + bridge budget), and this call gates EVERY source resolve. Stop this caller
  // waiting at 15s, while the shared initialization above keeps warming in the background.
  const sources = await Promise.race([
    jvmSourcesPending.value,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('The extension runtime did not answer in time.')), 15_000)),
  ])
  return sources
}

/** Installed, enabled anime sources that may supply catalog rows. Package/source enablement is the
 * hard permission boundary; the separate catalog switches only decide which of these are browsed. */
export async function installedJvmCatalogSources(): Promise<JvmCatalogSource[]> {
  const installed = await installedExtensionPackages()
  const allowed = liveJvmSources(installed, get(disabledPlugins))
  if (!allowed.size) return []
  const sources = await jvmSources()
  return dedupeJvmSources(sources)
    .filter((source) => source.type === 'anime' && allowed.has(source.id))
    .map((source) => ({
      id: source.id,
      name: source.name,
      lang: source.lang,
      icon: source.iconUrl ?? undefined,
      // Runtime 2.3 reports these from the actual source type; do not advertise methods merely
      // because an older listing omitted its capability flags.
      supportsLatest: source.supportsLatest === true,
      supportsPopular: source.supportsPopular === true,
    }))
}

async function requireJvmCatalogSource(sourceId: string): Promise<JvmCatalogSource> {
  const source = (await installedJvmCatalogSources()).find((entry) => entry.id === sourceId)
  if (!source) throw new Error('This Aniyomi source is no longer installed or enabled.')
  return source
}

export async function browseJvmCatalogSource(
  sourceId: string,
  method: 'getPopular' | 'getLatestUpdates' | 'search',
  page = 1,
  query = '',
  filters?: JvmSourceFilter[],
  signal?: AbortSignal,
): Promise<JvmCatalogPageResult> {
  await requireJvmCatalogSource(sourceId)
  const response = await jvmInvoke<{ list?: Record<string, unknown>[]; hasNextPage?: unknown }>(method, {
    sourceId,
    isAnime: true,
    page: Math.max(1, Math.floor(page)),
    ...(method === 'search' ? { query, ...(filters ? { filters } : {}) } : {}),
  }, signal)
  return { list: response.list ?? [], hasNextPage: response.hasNextPage === true }
}

export async function detailJvmCatalogSource(
  sourceId: string,
  media: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  await requireJvmCatalogSource(sourceId)
  return jvmInvoke<Record<string, unknown>>('getDetail', {
    sourceId,
    isAnime: true,
    media,
  }, signal)
}

export async function jvmCatalogSourceFilters(sourceId: string, signal?: AbortSignal): Promise<JvmSourceFilter[]> {
  await requireJvmCatalogSource(sourceId)
  return jvmInvoke<JvmSourceFilter[]>('getFilterList', { sourceId, isAnime: true }, signal)
}

export async function jvmCatalogSourcePreferences(sourceId: string, signal?: AbortSignal): Promise<JvmSourcePreference[]> {
  await requireJvmCatalogSource(sourceId)
  return jvmInvoke<JvmSourcePreference[]>('aniyomiGetPreferences', { sourceId, isAnime: true }, signal)
}

export async function saveJvmCatalogSourcePreference(
  sourceId: string,
  key: string,
  value: unknown,
): Promise<boolean> {
  await requireJvmCatalogSource(sourceId)
  return jvmInvoke<boolean>('aniyomiSavePreference', {
    sourceId,
    isAnime: true,
    key,
    action: 'change',
    value,
  })
}

async function runningJvmExtensions(onlyId?: string): Promise<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { id: string; name: string; lang?: string; call: (method: string, ...args: unknown[]) => Promise<any> }[]
> {
  const installed = await installedExtensionPackages()
  // Decided BEFORE the invoke below. Disabling was previously applied to the RESULTS of
  // `jvm_extension_sources`, so the Java runtime was still spawned to enumerate sources that were
  // then all thrown away — Java running on every resolve for someone who had switched every source
  // off, or never enabled one.
  const packageBySource = liveJvmSources(installed, get(disabledPlugins))
  if (!packageBySource.size) return []
  try {
    const sources = await jvmSources()
    return dedupeJvmSources(sources)
      .filter((source) =>
        source.type === 'anime'
        && packageBySource.has(source.id)
        && (!onlyId || source.id === onlyId),
      )
      .map((source) => ({
        id: source.id,
        name: source.name,
        lang: source.lang,
        call: (method: string, ...args: unknown[]) => jvmProviderCall(source, method, args),
      }))
  } catch {
    return []
  }
}

/** The live anime-torrent-provider extensions, each with a bound multi-arg `call`.
 *  torrentProvider.queryTorrentProviders drives search/smartSearch through it. */
export async function runningTorrentProviderExtensions(onlyId?: string): Promise<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { id: string; name: string; icon?: string; ready: Promise<boolean>; call: (method: string, ...args: unknown[]) => Promise<any> }[]
> {
  const exts = await ensureRunning()
  return exts
    .filter((e) => (!onlyId || e.cfg.id === onlyId) && e.cfg.type === 'anime-torrent-provider')
    .map((e) => ({
      id: e.cfg.id,
      name: e.cfg.name,
      icon: e.cfg.icon,
      ready: e.ready,
      call: afterExtensionReady(
        e.ready,
        (method: string, ...args: unknown[]) => callRaw(e, method, args),
        null,
      ),
    }))
}
