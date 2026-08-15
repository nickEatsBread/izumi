import { get, set } from 'idb-keyval'

const CACHE_PREFIX = 'extension-module:'
const VERSIONED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const UNVERSIONED_MAX_AGE_MS = 24 * 60 * 60 * 1000
const MAX_CACHED_CODE_BYTES = 16 * 1024 * 1024

interface ModuleCacheEntry {
  url: string
  version: string | null
  code: string
  fetchedAt: number
}

export interface CacheableExtensionModule {
  code: string
  version?: string
}

function cacheKey(url: string): string {
  return `${CACHE_PREFIX}${url}`
}

function usableCode(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function compatibleEntry(
  value: unknown,
  module: CacheableExtensionModule,
): ModuleCacheEntry | undefined {
  if (!value || typeof value !== 'object') return undefined
  const entry = value as Partial<ModuleCacheEntry>
  if (
    entry.url !== module.code
    || entry.version !== (module.version ?? null)
    || !usableCode(entry.code)
    || typeof entry.fetchedAt !== 'number'
    || !Number.isFinite(entry.fetchedAt)
  ) return undefined
  return entry as ModuleCacheEntry
}

/**
 * Load a remote extension module from IndexedDB when possible. A manifest version
 * change invalidates immediately; unversioned modules refresh daily. If a refresh
 * fails, a compatible stale copy keeps the extension usable offline.
 */
export async function loadCachedExtensionModule(
  module: CacheableExtensionModule,
  fetchFresh: () => Promise<string | null>,
  now = Date.now(),
): Promise<string | null> {
  let cached: ModuleCacheEntry | undefined
  try {
    cached = compatibleEntry(await get<ModuleCacheEntry>(cacheKey(module.code)), module)
  } catch {
    // IndexedDB may be unavailable in a private/restricted webview. Network loading still works.
  }

  const maxAge = module.version ? VERSIONED_MAX_AGE_MS : UNVERSIONED_MAX_AGE_MS
  const age = cached ? now - cached.fetchedAt : Number.POSITIVE_INFINITY
  if (cached && age >= 0 && age < maxAge) return cached.code

  let fresh: string | null
  try {
    fresh = await fetchFresh()
  } catch {
    return cached?.code ?? null
  }
  if (!usableCode(fresh)) return cached?.code ?? null

  // Do not make startup wait for the cache write. A failed or quota-limited write
  // only forfeits the next launch's fast path; it never prevents this launch.
  if (fresh.length <= MAX_CACHED_CODE_BYTES) {
    void set(cacheKey(module.code), {
      url: module.code,
      version: module.version ?? null,
      code: fresh,
      fetchedAt: now,
    } satisfies ModuleCacheEntry).catch(() => {})
  }
  return fresh
}
