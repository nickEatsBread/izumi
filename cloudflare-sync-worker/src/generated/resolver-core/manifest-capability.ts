// GENERATED from src/lib/stremio/manifest-capability.ts by scripts/generate-cloudflare-resolver-core.mjs.
// Edit the canonical source, then regenerate; do not edit this vendored copy.
// Pure Stremio manifest capability checks shared by the local client and cloud resolver.

export type AddonResource = string | { name: string; types?: string[]; idPrefixes?: string[] }

export interface AddonCatalogExtra {
  name: string
  isRequired?: boolean
  options?: string[]
  optionsLimit?: number
  /** izumi-only: artwork for some of the options (a category's backdrop on the Categories screen). */
  izumi?: { images?: Record<string, string> }
}

export interface AddonCatalog {
  type: string
  id: string
  name: string
  /** Legacy manifest field. Modern add-ons expose these as genre extra options. */
  genres?: string[]
  extra?: AddonCatalogExtra[]
  /** izumi-only hints: `home: false` keeps the listing off Home (Browse still lists it);
   *  `homeFilters: false` offers no filtered Home rows (one per genre, say), only the plain one;
   *  `browse: false` keeps it out of Browse's listings; `menu` lists it in the drawer as its own
   *  screen (a watchlist, a history), opening on a wall of the named extra's options first when it
   *  names one (`extra: "season"`). */
  izumi?: { home?: boolean; homeFilters?: boolean; browse?: boolean; menu?: { label?: string; icon?: string; extra?: string } }
  /** Legacy manifest fields: the extra names a catalog takes, and those it requires. */
  extraSupported?: string[]
  extraRequired?: string[]
}

export interface AddonManifest {
  id: string
  name: string
  version: string
  description?: string
  logo?: string
  background?: string
  resources?: AddonResource[]
  idPrefixes?: string[]
  types?: string[]
  catalogs?: AddonCatalog[]
  behaviorHints?: { configurable?: boolean; configurationRequired?: boolean }
}

/** Whether a manifest declares support for this stream type and id namespace. Unknown manifests
 * remain accepted, matching local Izumi's fail-open dispatch behaviour. */
export function acceptsStreamId(manifest: AddonManifest | null, type: string, id: string): boolean {
  return acceptsResourceId(manifest, 'stream', type, id)
}

/** acceptsStreamId for any resource (`meta`, `subtitles`, …). */
export function acceptsResourceId(manifest: AddonManifest | null, name: string, type: string, id: string): boolean {
  const resources = manifest?.resources
  if (!resources?.length) return true
  const matches = (types: string[] | undefined, prefixes: string[] | undefined) =>
    (!types?.length || types.includes(type))
    && (!prefixes?.length || prefixes.some((prefix) => id.startsWith(prefix)))
  for (const resource of resources) {
    if (typeof resource === 'string') {
      if (resource === name && matches(manifest?.types, manifest?.idPrefixes)) return true
    } else if (resource && resource.name === name
      // An object resource without its own idPrefixes accepts every id (Stremio's rule); the
      // manifest-level prefixes only apply to bare string resources.
      && matches(resource.types ?? manifest?.types, resource.idPrefixes)) {
      return true
    }
  }
  return false
}
