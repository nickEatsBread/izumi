import type { CommunityAddon } from '$lib/stremio/community-store'
import { resolveStoreAddonLogo } from '$lib/stremio/addon-logo'
import { normalizeBase } from '$lib/stremio/origin-id'
import { ADDON_DIRECTORY_ID, type ContentType, type StoreEntry } from './types'

const CONTENT: Readonly<Record<string, ContentType>> = { anime: 'anime', movie: 'movie', series: 'series' }

function clip(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined
}

/** A community directory listing as a Store entry, or null when it is unusable. Directory data is
 *  third-party, so every field is checked before it reaches filtering and rendering. The addon's
 *  manifest id is the entry id, so a configured copy (whose URL differs) is still recognised. */
export function directoryEntry(addon: CommunityAddon): StoreEntry | null {
  const manifest = addon?.manifest
  const id = clip(manifest?.id, 200)
  const name = clip(manifest?.name, 64)
  const base = typeof addon?.manifestUrl === 'string' ? normalizeBase(addon.manifestUrl) : ''
  if (!id || !name || !base) return null
  const types: unknown[] = Array.isArray(manifest.types) ? manifest.types : []
  const content = [...new Set(types.flatMap((type) =>
    typeof type === 'string' && Object.hasOwn(CONTENT, type) ? [CONTENT[type]] : []))]
  const configureUrl = clip(addon.configureUrl, 2048)
  return {
    key: `${ADDON_DIRECTORY_ID}:source:${id}`,
    storeId: ADDON_DIRECTORY_ID,
    kind: 'source',
    sourceType: 'stremio-addon',
    id,
    name,
    version: clip(manifest.version, 32),
    description: clip(manifest.description, 600) ?? 'Community Stremio addon',
    icon: resolveStoreAddonLogo(typeof manifest.logo === 'string' ? manifest.logo : undefined, base),
    languages: [],
    content,
    nsfw: false,
    requiresDebrid: false,
    popularity: typeof addon.stars === 'number' && Number.isFinite(addon.stars) ? addon.stars : undefined,
    updatedAt: clip(addon.createdAt, 40),
    install: { type: 'addon', manifestUrl: addon.manifestUrl, manifestId: id, ...(configureUrl ? { configureUrl } : {}) },
  }
}

/** A page of directory results as entries, keeping the most-starred listing of each addon: the
 *  directory can list one addon more than once, and entry keys must be unique. */
export function directoryEntries(addons: readonly CommunityAddon[]): StoreEntry[] {
  const best = new Map<string, StoreEntry>()
  for (const addon of addons) {
    const entry = directoryEntry(addon)
    if (!entry) continue
    const current = best.get(entry.key)
    if (!current || (entry.popularity ?? -1) > (current.popularity ?? -1)) best.set(entry.key, entry)
  }
  return [...best.values()]
}
