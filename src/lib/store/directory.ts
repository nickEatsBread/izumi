import type { CommunityAddon } from '$lib/stremio/community-store'
import { resolveStoreAddonLogo } from '$lib/stremio/addon-logo'
import { normalizeBase } from '$lib/stremio/origin-id'
import { ADDON_DIRECTORY_ID, type ContentType, type StoreEntry } from './types'

const CONTENT: Readonly<Record<string, ContentType>> = { anime: 'anime', movie: 'movie', series: 'series' }

/** A community directory listing as a Store entry. The manifest id is the entry id, so a configured
 *  copy (whose URL differs from the directory's) is still recognised as installed. */
export function directoryEntry(addon: CommunityAddon): StoreEntry {
  const content = [...new Set((addon.manifest.types ?? []).flatMap((type) => CONTENT[type] ? [CONTENT[type]] : []))]
  return {
    key: `${ADDON_DIRECTORY_ID}:source:${addon.manifest.id}`,
    storeId: ADDON_DIRECTORY_ID,
    kind: 'source',
    sourceType: 'stremio-addon',
    id: addon.manifest.id,
    name: addon.manifest.name,
    version: addon.manifest.version,
    description: addon.manifest.description || 'Community Stremio addon',
    icon: resolveStoreAddonLogo(addon.manifest.logo, normalizeBase(addon.manifestUrl)),
    languages: [],
    content,
    nsfw: false,
    requiresDebrid: false,
    popularity: addon.stars,
    updatedAt: addon.createdAt,
    install: { type: 'addon', manifestUrl: addon.manifestUrl, ...(addon.configureUrl ? { configureUrl: addon.configureUrl } : {}) },
  }
}
