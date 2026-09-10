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
      description: addon.manifest?.description?.trim() || `${addon.stars} stars`,
      url: addon.manifestUrl,
    }))
}

export function packageSuggestions(packages: readonly ExtensionCatalogPackage[], limit: number): SourceSuggestion[] {
  return packages
    .filter((entry) => !entry.nsfw)
    .slice(0, limit)
    .map((entry) => ({
      id: entry.id,
      kind: 'extension' as const,
      name: entry.name,
      description: entry.sources.length === 1 ? '1 source' : `${entry.sources.length} sources`,
      url: '',
    }))
}
