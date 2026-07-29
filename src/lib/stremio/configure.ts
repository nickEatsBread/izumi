import { listCommunityAddons, type CommunityAddon } from './community-store'
import type { AddonManifest } from './manifest'

const directoryCache = new Map<string, Promise<string | null>>()

/** Stremio SDK add-ons conventionally expose configuration at the origin's `/configure` route. */
export function inferAddonConfigureUrl(base: string, manifest: AddonManifest): string | null {
  if (!manifest.behaviorHints?.configurable && !manifest.behaviorHints?.configurationRequired) return null
  try {
    return new URL('/configure', base).toString()
  } catch {
    return null
  }
}

/** Resolve a configuration page without exposing configuration details in the settings UI. */
export function findAddonConfigureUrl(
  base: string,
  manifest: AddonManifest,
  knownAddons: CommunityAddon[] = [],
): Promise<string | null> {
  const listed = knownAddons.find((addon) => addon.manifest.id === manifest.id)?.configureUrl
  if (listed) return Promise.resolve(listed)

  const inferred = inferAddonConfigureUrl(base, manifest)
  if (inferred) return Promise.resolve(inferred)

  const cached = directoryCache.get(manifest.id)
  if (cached) return cached
  // Configured manifests often suffix their display name with the selected debrid provider.
  // Searching the stable portion gives the directory a chance to find the public add-on entry.
  const searchName = manifest.name.replace(/\s+(?:RD|AD|PM|DL|TB|ED|OC)\b.*$/i, '').trim()
  const request = listCommunityAddons({ search: searchName || manifest.name, limit: 50 })
    .then((page) => page.addons.find((addon) => addon.manifest.id === manifest.id)?.configureUrl ?? null)
    .catch(() => null)
  directoryCache.set(manifest.id, request)
  return request
}
