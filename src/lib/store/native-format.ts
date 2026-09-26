import type { IzumiCatalogPackage } from '$lib/extensions/catalog'
import { parseRelease, type ThemeRelease } from '$lib/themes/packages'
import { SUPPORTED_STORE_KINDS, type ContentType, type SourceType, type StoreEntry, type StoreKind } from './types'
import { canonicalStoreUrl } from './url'

// Parser for the native store index (spec §6.3). Pure: the caller fetches.

export const MAX_STORE_BYTES = 2_000_000
export const MAX_STORE_ENTRIES = 2000
const ID = /^[a-z0-9][a-z0-9.-]{1,63}$/
const SHA256 = /^[a-f0-9]{64}$/i
const PUBLIC_KEY = /^ed25519:[A-Za-z0-9+/]{43}=$/
const KINDS: readonly StoreKind[] = ['plugin', 'theme', 'pack', 'source']
const SOURCE_TYPES: readonly SourceType[] = ['stremio-addon', 'torrent-provider', 'stream-provider', 'package']
const CONTENT: readonly ContentType[] = ['anime', 'movie', 'series']

export interface NativeStoreMeta {
  id: string
  name: string
  description?: string
  homepage?: string
  icon?: string
  publicKey?: string
}

export function isNativeStore(raw: unknown): raw is Record<string, unknown> {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw)
    && (raw as Record<string, unknown>).app === 'izumi'
    && (raw as Record<string, unknown>).kind === 'store'
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : undefined
}

function httpsUrl(value: unknown, base: string): string | undefined {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) return undefined
  try {
    // Public HTTPS only, like the store itself: icons and previews load on sight, so a listing must
    // not be able to point the app at the user's own network.
    const url = new URL(value, base)
    // The canonical form is only the gate: the link itself keeps its fragment (hash-routed pages).
    return canonicalStoreUrl(url.href) ? url.href : undefined
  } catch {
    return undefined
  }
}

function words<T extends string>(value: unknown, allowed?: readonly T[]): T[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is T => typeof item === 'string' && item.length > 0 && item.length <= 32
      && (!allowed || allowed.includes(item as T)))
    .slice(0, 24)
}

function sha(value: unknown): string | undefined {
  return typeof value === 'string' && SHA256.test(value) ? value.toLowerCase() : undefined
}

function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

/** Store and entry ids: the theme id rule, including its reserved words. */
function validId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value) && value !== 'constructor' && value !== 'prototype'
}

/** Parse a native store index. Throws for a document that is not a valid store; malformed entries
 *  are skipped and counted, entries of kinds this build cannot install are ignored. */
export function parseNativeStore(
  raw: unknown,
  storeUrl: string,
  storeId: string,
): { meta: NativeStoreMeta; entries: StoreEntry[]; skipped: number } {
  if (!isNativeStore(raw)) throw new Error('That is not an izumi store index.')
  if (typeof raw.schemaVersion !== 'number' || !Number.isInteger(raw.schemaVersion) || raw.schemaVersion < 1) {
    throw new Error('This store index has no valid schemaVersion.')
  }
  if (raw.schemaVersion > 1) throw new Error('This store uses a newer format. Update izumi to open it.')
  const id = validId(raw.id) ? raw.id : undefined
  const name = text(raw.name, 64)
  if (!id || !name) throw new Error('This store index is missing a valid id or name.')
  if (!Array.isArray(raw.entries)) throw new Error('This store index has no entries list.')
  if (raw.entries.length > MAX_STORE_ENTRIES) throw new Error('This store lists more than 2000 entries.')
  if (raw.publicKey !== undefined && (typeof raw.publicKey !== 'string' || !PUBLIC_KEY.test(raw.publicKey))) {
    throw new Error('This store declares an invalid signing key.')
  }
  const meta: NativeStoreMeta = {
    id,
    name,
    description: text(raw.description, 600),
    homepage: httpsUrl(raw.homepage, storeUrl),
    icon: httpsUrl(raw.icon, storeUrl),
    ...(typeof raw.publicKey === 'string' ? { publicKey: raw.publicKey } : {}),
  }
  const entries: StoreEntry[] = []
  const seen = new Set<string>()
  let skipped = 0
  for (const item of raw.entries) {
    const entry = parseEntry(item, storeUrl, storeId)
    if (entry === 'ignored') continue
    if (!entry || seen.has(entry.key)) {
      skipped += 1
      continue
    }
    seen.add(entry.key)
    entries.push(entry)
  }
  return { meta, entries, skipped }
}

function parseEntry(item: unknown, storeUrl: string, storeId: string): StoreEntry | null | 'ignored' {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  const e = item as Record<string, unknown>
  if (typeof e.kind !== 'string' || !KINDS.includes(e.kind as StoreKind)) return 'ignored'
  const kind = e.kind as StoreKind
  // Kinds later phases install (plugins, packs) are part of the format but not listed yet.
  if (!SUPPORTED_STORE_KINDS.includes(kind)) return 'ignored'
  const id = validId(e.id) ? e.id : undefined
  const name = text(e.name, 64)
  if (!id || !name) return null
  const common = {
    storeId,
    id,
    name,
    version: text(e.version, 32),
    author: text(e.author, 80),
    description: text(e.description, 600),
    icon: httpsUrl(e.icon, storeUrl),
    preview: httpsUrl(e.preview, storeUrl),
    homepage: httpsUrl(e.homepage, storeUrl),
    languages: words(e.languages).map((language) => language.toLowerCase()),
    content: words(e.content, CONTENT),
    nsfw: e.nsfw === true,
    requiresDebrid: e.requiresDebrid === true,
    updatedAt: text(e.updatedAt, 40),
  }
  if (kind === 'theme') {
    // Themes follow the theme catalog's own rules exactly (ids, sizes, versions, hashes, platforms),
    // so nothing is listed that the theme installer would later refuse.
    let release: ThemeRelease
    try {
      release = parseRelease({
        id,
        name,
        version: e.version,
        author: e.author,
        description: e.description,
        themeApi: e.themeApi,
        tags: Array.isArray(e.tags) ? e.tags : [],
        platforms: e.platforms,
        download: httpsUrl(e.url, storeUrl),
        sha256: e.sha256,
        bytes: e.bytes,
        ...(common.preview ? { preview: common.preview } : {}),
        ...(common.homepage ? { project: common.homepage } : {}),
      })
    } catch {
      return null
    }
    return {
      ...common,
      key: `${storeId}:theme:${id}`,
      kind,
      version: release.version,
      author: release.author,
      description: release.description,
      install: { type: 'theme', release },
    }
  }
  const sourceType = typeof e.sourceType === 'string' && SOURCE_TYPES.includes(e.sourceType as SourceType)
    ? e.sourceType as SourceType
    : undefined
  if (!sourceType) return 'ignored'
  const key = `${storeId}:source:${id}`
  if (sourceType === 'package') {
    const url = httpsUrl(e.url, storeUrl)
    const sha256 = sha(e.sha256)
    const bytes = positive(e.bytes)
    if (!url || !sha256 || !bytes || !common.version) return null
    const backend: IzumiCatalogPackage['backend'] = e.backend === 'aniyomi-jvm'
      ? 'aniyomi-jvm'
      : e.backend === 'izumi-service' ? 'izumi-service' : 'izumi-js'
    const pkg: IzumiCatalogPackage = {
      packageFormat: 'izumi-ext',
      id,
      name,
      version: common.version,
      language: common.languages[0],
      nsfw: common.nsfw,
      sources: [],
      backend,
      package: url,
      packageSha256: sha256,
      packageBytes: bytes,
    }
    return { ...common, key, kind, sourceType, install: { type: 'package', pkg } }
  }
  const manifestUrl = httpsUrl(e.manifestUrl, storeUrl)
  if (!manifestUrl) return null
  if (sourceType === 'stremio-addon') {
    const configureUrl = httpsUrl(e.configureUrl, storeUrl)
    const manifestId = text(e.manifestId, 200)
    // Configuring checks the configured link against the addon's own manifest id, so a configurable
    // entry must say what that id is.
    if (configureUrl && !manifestId) return null
    return {
      ...common, key, kind, sourceType,
      install: { type: 'addon', manifestUrl, ...(configureUrl ? { configureUrl } : {}), ...(manifestId ? { manifestId } : {}) },
    }
  }
  return { ...common, key, kind, sourceType, install: { type: 'extension', spec: manifestUrl } }
}
