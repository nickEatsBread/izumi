import { resolveAddonLogo } from '$lib/stremio/addon-logo'
import type { CommunityAddon } from '$lib/stremio/community-store'
import type { ExtensionCatalogPackage } from '$lib/extensions/catalog'

export interface SourceSuggestion {
  /** Stable tick key. The manifest URL for an addon, the package id for an extension. */
  id: string
  kind: 'addon' | 'extension'
  name: string
  description: string
  /** Manifest URL for an addon; empty for an extension, which installs from its catalog entry. */
  url: string
  /** The source's own artwork, when the directory supplies one. Catalog packages have none until
   *  they are installed — their icon is the launcher icon inside the package — so the row falls
   *  back to the app's shared source placeholder rather than showing nothing. */
  logo?: string
}

/** Directory order is already relevance order, so this only trims and reshapes. */
export function addonSuggestions(addons: readonly CommunityAddon[], limit: number): SourceSuggestion[] {
  return addons
    .filter((addon) => Boolean(addon.manifestUrl))
    .slice(0, limit)
    .map((addon) => ({
      id: addon.manifestUrl,
      kind: 'addon' as const,
      name: addon.manifest?.name || addon.slug,
      description: addon.manifest?.description?.trim() || (addon.stars === 1 ? '1 star' : `${addon.stars} stars`),
      url: addon.manifestUrl,
      // Manifests may declare a relative logo, so it has to be resolved against the manifest URL.
      logo: resolveAddonLogo(addon.manifest?.logo, addon.manifestUrl),
    }))
}

export function packageSuggestions(packages: readonly ExtensionCatalogPackage[], limit: number): SourceSuggestion[] {
  return packages
    .filter((entry) => !entry.nsfw)
    .slice(0, limit)
    .map((entry) => {
      const sources = entry.sources?.length ?? 0
      return {
        id: entry.id,
        kind: 'extension' as const,
        name: entry.name,
        description: sources === 1 ? '1 source' : `${sources} sources`,
        url: '',
      }
    })
}
