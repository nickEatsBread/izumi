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
  if (!entries.some((e) => e && typeof e === 'object')) return 'That URL did not return a valid manifest.'
  if (entries.every((e) => e?.type && !SUPPORTED_TYPES.includes(e.type))) {
    return 'This source only provides types izumi can\'t run (for example manga providers or UI plugins).'
  }
  return 'No runnable extensions were found in this source.'
}

// Normalize both flat configs (with `code`) and manifest arrays (with
// `main` + `update`) into ExtensionConfig[].
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeManifest(raw: any, manifestUrl: string): ExtensionConfig[] {
  const entries = Array.isArray(raw) ? raw : [raw]
  const out: ExtensionConfig[] = []
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue
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
