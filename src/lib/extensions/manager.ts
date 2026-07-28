import { invoke } from '@tauri-apps/api/core'
import { get } from 'svelte/store'
import { invokeNativeHttp, phttp } from '$lib/net/http'
import { enabledExtensionUrls, disabledPlugins } from '$lib/settings/ui'
import type { TorrentResult, TorrentQuery, ExtensionConfig } from './types'
import { resolveManifestUrl, normalizeManifest, pointerUrl, isRunnableType, manifestProblem, catalogPackages } from './catalog'
import type { ExtensionCatalogPackage } from './catalog'
import { extensionSourceConfigured, liveJvmSources } from './availability'
import { clearProviderCache } from '$lib/stremio/online-cache'
import { dedupeJvmSources, normalizeJvmSidecarUrl, parseJvmVideoTitle } from './jvm-video'

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
let installedRevision = 0
let buildGeneration = 0

export interface InstalledExtensionPackage {
  id: string
  name: string
  version: string
  lang?: string
  description?: string
  code?: string
  backend: 'izumi-js' | 'aniyomi-jvm'
  sourceId: string
  sourceIds: string[]
  signed: boolean
}

export type { ExtensionCatalogPackage, ExtensionCatalog } from './catalog'

/** The maintained anime/HTTP package catalog. Not installed by default and not offered in the UI —
 *  a catalog is added the same way any other source is, by pasting its URL. Kept here as the
 *  canonical address of the repo the packages are published to. */
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
}

function resetRunning(): void {
  running?.forEach((extension) => extension.worker.terminate())
  running = null
  builtFrom = ''
  buildPromise = null
  buildGeneration += 1
  clearProviderCache()
}

export async function installedExtensionPackages(): Promise<InstalledExtensionPackage[]> {
  try {
    return await invoke<InstalledExtensionPackage[]>('extension_list')
  } catch {
    return []
  }
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
  installedRevision += 1
  resetRunning()
  return installed
}

export async function removeInstalledExtension(id: string): Promise<void> {
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
  return [...results.flat(), ...local].filter((c) => !off.includes(c.id))
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
        const r = await invokeNativeHttp<{ status: number; url: string; headers: Record<string, string>; setCookie: string[]; body: string }>('ext_fetch', {
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
  if (running && builtFrom === key) return running
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
        return { cfg, code: cfg.moduleCode ?? await fetchModuleCode(cfg.code) }
      } catch {
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

/** Pre-boot the extension runtime (manifest + modules + workers) off the click-to-play path.
 *  Called once at app start; the first picker open then only pays the actual search. */
export function warmExtensions(): void {
  void ensureRunning().catch(() => {})
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
  const [exts, jvm] = await Promise.all([ensureRunning(), runningJvmExtensions(onlyId)])
  const live = (await Promise.all(
    exts.filter((e) => !onlyId || e.cfg.id === onlyId)
      .map(async (e) => ((await e.ready) && e.cfg.type === 'onlinestream-provider' ? e : null)),
  )).filter(Boolean) as RunningExt[]
  return [
    ...live.map((e) => ({ id: e.cfg.id, name: e.cfg.name, lang: e.cfg.lang, call: (method: string, ...args: unknown[]) => callRaw(e, method, args) })),
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

function mediaType(url: string): 'm3u8' | 'dash' | 'mp4' {
  if (/\.m3u8(?:[?#]|$)/i.test(url)) return 'm3u8'
  if (/\.mpd(?:[?#]|$)/i.test(url)) return 'dash'
  return 'mp4'
}

async function jvmProviderCall(source: JvmSource, method: string, callArgs: unknown[]): Promise<unknown> {
  if (method === 'getSettings') {
    // JVM getVideoList already returns every server and audio flavour in one response. Marking this
    // prevents the online layer from issuing identical sub + dub calls (and starting two competing
    // provider localhost servers) while still allowing its per-video title to carry SUB/DUB.
    return { episodeServers: ['default'], returnsMixedAudio: true }
  }
  if (method === 'search') {
    const input = (callArgs[0] ?? {}) as { query?: unknown }
    const response = await invoke<{ list?: Record<string, unknown>[] }>('jvm_extension_call', {
      method: 'search',
      args: { sourceId: source.id, query: String(input.query ?? ''), page: 1, isAnime: true },
    })
    return (response.list ?? []).map((item) => ({
      id: JSON.stringify({ url: item.url, title: item.title, cover: item.cover }),
      title: String(item.title ?? ''),
      url: String(item.url ?? ''),
    }))
  }
  if (method === 'findEpisodes') {
    const identity = JSON.parse(String(callArgs[0] ?? '{}')) as { url?: string; title?: string; cover?: string }
    const detail = await invoke<{ title?: unknown; episodes?: Record<string, unknown>[] }>('jvm_extension_call', {
      method: 'getDetail',
      args: {
        sourceId: source.id,
        media: {
          url: identity.url ?? '',
          title: identity.title ?? '',
          thumbnail_url: identity.cover ?? '',
        },
        isAnime: true,
      },
    })
    return (detail.episodes ?? [])
      .map((episode) => ({
        id: JSON.stringify({ url: episode.url, name: episode.name }),
        number: episodeNumber(episode),
        title: String(episode.name ?? ''),
        url: String(episode.url ?? ''),
        // Keep the detail page's canonical identity attached through episode resolution. Search
        // pages can be fuzzy or redirect; the online resolver revalidates this before fetching video.
        sourceTitle: String(detail.title ?? identity.title ?? ''),
      }))
      .filter((episode) => Number.isFinite(episode.number))
  }
  if (method === 'findEpisodeServer') {
    const raw = callArgs[0] as { id?: unknown } | string
    const encoded = typeof raw === 'string' ? raw : raw?.id
    const episode = JSON.parse(String(encoded ?? '{}')) as { url?: string; name?: string }
    const videos = await invoke<Record<string, unknown>[]>('jvm_extension_call', {
      method: 'getVideoList',
      args: {
        sourceId: source.id,
        episode: { url: episode.url ?? '', name: episode.name ?? '' },
      },
    })
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
          type: mediaType(url),
          quality: String(video.quality ?? identity.quality ?? video.title ?? 'auto'),
          server: identity.server,
          audio: identity.audio,
          subtitleMode: identity.subtitleMode === 'hard'
            ? 'hard'
            : subtitles.length ? 'soft' : undefined,
          headers: (video.headers ?? {}) as Record<string, string>,
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
    const sources = await invoke<JvmSource[]>('jvm_extension_sources')
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
  { id: string; name: string; icon?: string; call: (method: string, ...args: unknown[]) => Promise<any> }[]
> {
  const exts = await ensureRunning()
  const live = (await Promise.all(
    exts.filter((e) => !onlyId || e.cfg.id === onlyId)
      .map(async (e) => ((await e.ready) && e.cfg.type === 'anime-torrent-provider' ? e : null)),
  )).filter(Boolean) as RunningExt[]
  return live.map((e) => ({ id: e.cfg.id, name: e.cfg.name, icon: e.cfg.icon, call: (method: string, ...args: unknown[]) => callRaw(e, method, args) }))
}
