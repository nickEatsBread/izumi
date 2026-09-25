import type { ExtensionCatalogPackage } from '$lib/extensions/catalog'
import type { ThemeRelease } from '$lib/themes/packages'

// Shared vocabulary of the unified Store (docs/superpowers/specs/2026-09-25-plugins-stores-packs-design.md
// §5-§6). Every store format is normalised into StoreEntry, so filtering, installing and rendering
// never depend on which format a store was published in.

/** Kinds a store may list. Plugins and packs are part of the format already so documents written
 *  today stay valid; this build installs SUPPORTED_STORE_KINDS and ignores the rest. */
export type StoreKind = 'plugin' | 'theme' | 'pack' | 'source'
export type SourceType = 'stremio-addon' | 'torrent-provider' | 'stream-provider' | 'package'
export type ContentType = 'anime' | 'movie' | 'series'

export const SUPPORTED_STORE_KINDS: readonly StoreKind[] = ['theme', 'source']

/** The community addon directory is searched on its server: a store without an index URL. */
export const ADDON_DIRECTORY_ID = 'addon-directory'

export type InstallRef =
  /** `manifestId` is the addon's own manifest id: configured copies are matched and checked by it. */
  | { type: 'addon'; manifestUrl: string; configureUrl?: string; manifestId?: string }
  | { type: 'extension'; spec: string }
  | { type: 'package'; pkg: ExtensionCatalogPackage }
  | { type: 'theme'; release: ThemeRelease }

export interface StoreEntry {
  /** `${storeId}:${kind}:${id}` — unique across every loaded store. */
  key: string
  storeId: string
  kind: StoreKind
  sourceType?: SourceType
  id: string
  name: string
  version?: string
  author?: string
  description?: string
  icon?: string
  preview?: string
  homepage?: string
  /** ISO 639-1 content languages; empty when the store doesn't say. */
  languages: string[]
  content: ContentType[]
  nsfw: boolean
  requiresDebrid: boolean
  /** Store-provided ranking signal (directory stars). Higher is more popular. */
  popularity?: number
  /** When the store says the entry last changed (ISO 8601). */
  updatedAt?: string
  install: InstallRef
}

export type StoreAdapterId = 'izumi-store' | 'theme-catalog' | 'izumi-ext-catalog' | 'aniyomi-index' | 'marketplace'

export interface StoreListing {
  storeId: string
  adapter: StoreAdapterId
  name?: string
  description?: string
  icon?: string
  homepage?: string
  /** `ed25519:<base64 32 bytes>` when a native store declares a signing key. */
  publicKey?: string
  entries: StoreEntry[]
  /** Entries dropped as malformed. Unknown kinds are ignored and not counted. */
  skipped: number
}
