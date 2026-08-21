// Pure manifest/catalog shape handling for source extensions: spec → URL resolution, catalog
// pointer detection, and manifest → ExtensionConfig normalization. Split out of manager.ts so it
// carries no Tauri/store imports and can be unit-tested directly; manager.ts owns the I/O and the
// Worker lifecycle.

import type { ExtensionConfig } from './types'

// Turn a stored spec into a fetchable manifest URL. Accepts these forms:
//   gh:owner/repo[/sub]      → https://esm.sh/gh/owner/repo[/sub]/index.json
//   owner/repo[/sub]         → same (GitHub shorthand, matches the settings display)
//   npm:pkg[/sub]            → https://esm.sh/pkg[/sub]/index.json
//   https://…                → as given (existing full-URL manifests)
export function resolveManifestUrl(spec: string): string {
  const s = spec.trim()
  if (/^https?:\/\//i.test(s)) return s
  if (s.startsWith('gh:')) return withIndexJson(`https://esm.sh/gh/${s.slice(3).replace(/\/+$/, '')}`)
  if (s.startsWith('npm:')) return withIndexJson(`https://esm.sh/${s.slice(4).replace(/\/+$/, '')}`)
  // Bare GitHub shorthand: owner (no dots) / repo[/sub].
  if (/^[A-Za-z0-9][A-Za-z0-9-]*\/[^\s:]+$/.test(s)) return withIndexJson(`https://esm.sh/gh/${s.replace(/\/+$/, '')}`)
  return withIndexJson(`https://${s}`)
}
const withIndexJson = (base: string) => (/\.json(\?|$)/i.test(base) ? base : `${base.replace(/\/+$/, '')}/index.json`)

/**
 * A readable name for a source spec.
 *
 * Manifest documents almost never carry a title of their own (the two biggest marketplaces are
 * bare arrays), so a source added as a full URL had nothing to show but the URL itself, truncated
 * mid-path to unreadability. Collapse GitHub-hosted URLs to `owner/repo` — the same shape a `gh:`
 * spec already displays — and everything else to its hostname.
 */
export function sourceLabel(spec: string): string {
  const s = spec.trim()
  if (!/^https?:\/\//i.test(s)) return s.replace(/^gh:/, '').replace(/\/+$/, '')
  let url: URL
  try { url = new URL(s) } catch { return s }
  const host = url.hostname.replace(/^www\./i, '').toLowerCase()
  const seg = url.pathname.split('/').filter(Boolean)
  if ((host === 'raw.githubusercontent.com' || host === 'github.com' || host === 'gist.githubusercontent.com') && seg.length >= 2) {
    return `${seg[0]}/${seg[1]}`
  }
  // esm.sh/gh/owner/repo/… and jsdelivr's gh/owner/repo@ref/… both keep the repo one level in.
  if ((host === 'esm.sh' || host === 'cdn.jsdelivr.net') && seg[0] === 'gh' && seg.length >= 3) {
    return `${seg[1]}/${seg[2].split('@')[0]}`
  }
  return host
}

/** One `.izumi-ext` package in a maintained catalog: a downloadable, hash-pinned payload rather
 *  than a module izumi runs straight off the network. */
export interface ExtensionCatalogPackage {
  id: string
  name: string
  version: string
  language?: string
  nsfw: boolean
  sources: Array<{
    id: string
    name: string
    language?: string
    baseUrl?: string
  }>
  backend: 'izumi-js' | 'aniyomi-jvm' | 'izumi-service'
  package: string
  packageSha256: string
  packageBytes: number
}

export interface ExtensionCatalog {
  formatVersion: 1
  generatedAt: string
  scope: {
    content: 'anime'
    transport: 'http'
    manga: false
  }
  packages: ExtensionCatalogPackage[]
}

/**
 * The packages a document declares when it IS an izumi package catalog, otherwise null.
 *
 * A catalog is recognized wherever a source URL is accepted, so adding one is the same gesture as
 * adding a manifest — the settings list decides which row to draw from this answer. `null` and `[]`
 * are different answers on purpose: an empty catalog is still a catalog, and must not fall through
 * to manifest expansion and be reported as a broken manifest.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function catalogPackages(raw: any): ExtensionCatalogPackage[] | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (raw.formatVersion !== 1) return null
  if (raw.scope?.content !== 'anime' || raw.scope?.transport !== 'http' || raw.scope?.manga !== false) return null
  if (!Array.isArray(raw.packages)) return null
  // Entries missing an id or a payload can't be installed or tracked; drop them rather than
  // rendering a row whose Install button throws.
  return raw.packages.filter((p: unknown): p is ExtensionCatalogPackage =>
    !!p && typeof p === 'object'
    && typeof (p as ExtensionCatalogPackage).id === 'string'
    && typeof (p as ExtensionCatalogPackage).package === 'string')
}

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

/** Extension types we can actually run. Anything else in a catalog (manga providers, UI
 *  plugins, …) is skipped — early, so a mixed marketplace doesn't cost us their fetches. */
export const SUPPORTED_TYPES = ['torrent', 'onlinestream-provider', 'anime-torrent-provider']

/** True when a catalog entry names a type we can't run. Absent type = unknown, so keep it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const isRunnableType = (e: any): boolean => !e?.type || SUPPORTED_TYPES.includes(e.type)

/** Legacy izumi torrent SDK (`single`/`batch`/`movie`). Streaming and anime-torrent-provider
 *  extensions have their own query paths and must not be asked for magnets. */
export function isLegacyTorrentType(type?: string): boolean {
  return !type || type === 'torrent'
}

export function extensionBackendLabel(backend: string): string {
  if (backend === 'izumi-service') return 'Local service'
  if (backend === 'izumi-js') return 'Native'
  if (backend === 'aniyomi-jvm') return 'Aniyomi'
  return backend
}

// Resolve a catalog entry to the manifest URL it POINTS AT, or null when the entry is a
// config in its own right. Two catalog dialects:
//   • bare pointer  — only `main`/`url`, no SourceConfig identity fields
//   • marketplace   — rich entry (id/name/type/icon) whose `manifestURI` names a SECOND
//     document that carries the actual `payloadURI`. A per-provider manifest also carries a
//     self-referential `manifestURI`, so `payloadURI`/`code` present ⇒ config, never a pointer.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function pointerUrl(e: any): string | null {
  if (!e || typeof e !== 'object') return null
  if (e.code || e.payloadURI) return null
  if (e.manifestURI) return String(e.manifestURI)
  if ((e.main || e.url) && e.id == null && e.name == null && e.update == null && e.type == null && e.version == null) {
    return String(e.main ?? e.url)
  }
  return null
}

/**
 * Why a manifest produced no runnable extensions, in words a user can act on.
 *
 * The common case is pointing izumi at a COMPILED Android plugin repository. Those serve `.cs3`
 * files — a zip of Dalvik bytecode linked against the host app's own classes — which no JavaScript
 * runtime can execute. izumi used to expand such a repo to an empty list and display nothing at
 * all, which reads as "izumi is broken" rather than "this format is not supported".
 *
 * Returns undefined when the manifest looks fine (the caller only asks when nothing loaded).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function manifestProblem(raw: any): string | undefined {
  const entries = Array.isArray(raw) ? raw : [raw]
  const compiled = 'Compiled Android plugins (.cs3) can\'t run here — this is a source-extension app, not an Android host. Use a JavaScript extension repository instead.'
  // A repo index: {name, pluginLists:[…]} pointing at plugin lists of .cs3 builds.
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray(raw.pluginLists)) return compiled
  // A plugin list: entries carrying a `.cs3` (or `.jar`) build URL, or the compiled-plugin fields.
  if (entries.some((e) => e && typeof e === 'object'
    && (/\.(?:cs3|jar)(?:\?|$)/i.test(String(e.url ?? '')) || e.jarUrl || (e.internalName && e.apiVersion != null)))) {
    return compiled
  }
  // A package catalog that `catalogPackages` refused — a newer formatVersion, or a scope with
  // content izumi has no runtime for. Say which, so it doesn't read as an unreachable URL.
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray(raw.packages)) {
    return 'This package catalog uses a format version or scope izumi can\'t read. Update izumi, or use a different catalog.'
  }
  if (!entries.some((e) => e && typeof e === 'object')) return 'That URL did not return a valid manifest.'
  if (entries.every((e) => e?.type && !SUPPORTED_TYPES.includes(e.type))) {
    return 'This source only provides types izumi can\'t run (for example manga providers or UI plugins).'
  }
  return 'No runnable extensions were found in this source.'
}

// A catalog whose entries are `{package, url, type}` with the payloads in a `repo/` folder beside
// the index. `type` is that format's content kind, NOT one of ours: only its video kind maps to a
// runnable extension; its manga and novel kinds have no runtime here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isPackageEntry = (e: any): boolean =>
  !!e && typeof e === 'object' && typeof e.package === 'string' && typeof e.url === 'string'
  && typeof e.type === 'string' && !e.code && !e.main && !e.payloadURI

/** Video kind → izumi's direct-streaming type. Everything else is skipped. */
const PACKAGE_VIDEO_TYPE = 'bangumi'

/** `url` is relative to a `repo/` folder beside the index, per that format's layout. */
function packageCodeUrl(url: string, manifestUrl: string): string {
  if (/^https?:\/\//i.test(url)) return url
  const base = manifestUrl.replace(/\/[^/]*$/, '/')
  return new URL(`repo/${url.replace(/^\/+/, '')}`, base).toString()
}

// Normalize both flat configs (with `code`) and manifest arrays (with
// `main` + `update`) into ExtensionConfig[].
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeManifest(raw: any, manifestUrl: string): ExtensionConfig[] {
  const entries = Array.isArray(raw) ? raw : [raw]
  const out: ExtensionConfig[] = []
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue
    if (isPackageEntry(e)) {
      if (e.type !== PACKAGE_VIDEO_TYPE) continue
      out.push({
        id: String(e.package),
        name: String(e.name ?? e.package),
        version: e.version ? String(e.version) : undefined,
        type: 'onlinestream-provider',
        code: packageCodeUrl(String(e.url), manifestUrl),
        icon: e.icon,
        description: e.description,
        lang: e.lang && e.lang !== 'all' ? String(e.lang).toLowerCase().split('-')[0] : undefined,
      })
      continue
    }
    // Seanime manifests carry the module URL in `payloadURI` (a full https URL), not `code`/`main`.
    const codeSpec = e.code ?? e.main ?? e.payloadURI
    if (!codeSpec) continue
    if (!isRunnableType(e)) continue
    out.push({
      id: String(e.id ?? e.name ?? codeSpec),
      name: String(e.name ?? e.id ?? 'Extension'),
      version: e.version,
      type: e.type,
      code: e.payloadURI ? String(e.payloadURI) : resolveCodeUrl(e, manifestUrl),
      icon: e.icon,
      description: e.description,
      // `lang` is the CONTENT language; `language` (javascript/typescript) is the payload's source
      // language and must never be read as one. Dropping this was why a French provider looked
      // identical to an English one in the picker.
      lang: e.lang ? String(e.lang).toLowerCase() : undefined,
      settings: e.settings,
    })
  }
  return out
}
