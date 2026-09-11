import { writable } from 'svelte/store'
import type { Media } from '$lib/anilist/types'
import { loadDiscoveryCandidates } from './candidates'
import { idle } from '$lib/util/idle'

/**
 * Module-level cache of cross-catalog candidates for the local "Recommended for You" row.
 *
 * Gathering candidates is inherently networked, but the row must never wait on it: the row reads
 * `localCandidatePool` synchronously from whatever the last gather produced, and a cold cache only
 * schedules an idle-time refresh (never on the first-paint path). Discover's gatherer is reused
 * as-is so the row sees exactly the catalogs the Library page sees, including installed Stremio
 * add-on home lists. A failed refresh keeps the previous pool and clears the loading flag, so a
 * broken add-on can at worst leave the row empty — never a stuck skeleton.
 */
const POOL_TTL_MS = 15 * 60_000
const MAX_POOL = 400

export const localCandidatePool = writable<Media[]>([])
/** True only while an actual refresh is in flight; the row may show a skeleton on this. */
export const localCandidatesLoading = writable(false)

let pool: Media[] = []
let storedAt = 0
let refresh: Promise<void> | null = null
let scheduled = false

/** Synchronous read for non-reactive callers; components should subscribe to `localCandidatePool`. */
export function cachedLocalCandidates(): Media[] {
  return pool
}

/** Schedule an idle-time refresh when the cached pool is cold or stale. Cheap to call from a
 * reactive effect: within the TTL it is a no-op, and at most one refresh and one scheduled
 * callback can exist at a time. */
export function primeLocalCandidates(providers: unknown): void {
  if (refresh || scheduled) return
  if (pool.length && Date.now() - storedAt < POOL_TTL_MS) return
  scheduled = true
  // Idle, not immediate: the row renders from cache (or nothing) first; this only warms the pool.
  idle(() => {
    scheduled = false
    void refreshPool(providers)
  }, 1500)
}

function refreshPool(providers: unknown): Promise<void> {
  if (refresh) return refresh
  localCandidatesLoading.set(true)
  refresh = (async () => {
    try {
      const result = await loadDiscoveryCandidates(providers)
      pool = result.media.slice(0, MAX_POOL)
      storedAt = Date.now()
      localCandidatePool.set(pool)
    } catch {
      // Cold cache just means an empty local row for now; the next prime retries after the TTL.
    } finally {
      refresh = null
      localCandidatesLoading.set(false)
    }
  })()
  return refresh
}

/** Test hook: drop the module cache so a suite starts cold regardless of import order. */
export function resetLocalCandidatePool(): void {
  pool = []
  storedAt = 0
  refresh = null
  scheduled = false
  localCandidatePool.set([])
  localCandidatesLoading.set(false)
}
