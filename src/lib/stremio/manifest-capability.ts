// Pure Stremio manifest capability checks shared by the local client and cloud resolver.

export type AddonResource = string | { name: string; types?: string[]; idPrefixes?: string[] }

export interface AddonCatalogExtra {
  name: string
  isRequired?: boolean
  options?: string[]
  optionsLimit?: number
}

export interface AddonCatalog {
  type: string
  id: string
  name: string
  /** Legacy manifest field. Modern add-ons expose these as genre extra options. */
  genres?: string[]
  extra?: AddonCatalogExtra[]
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
