import { makeOperation, mapExchange, type Exchange, type Operation } from '@urql/core'
import type { StorageAdapter } from '@urql/exchange-graphcache'
import { makeDefaultStorage } from '@urql/exchange-graphcache/default-storage'

// Graphcache persisted to IndexedDB, so a cold boot paints Home from the last session's normalized
// data instead of skeleton-waiting behind the 30-requests-per-minute AniList limiter.
//
// Two rules keep this from changing what the network sees:
//   1. The FIRST execution of each query per session revalidates (`cache-and-network`): the cached
//      rows paint immediately and the same single request today's `cache-first` boot would have
//      made runs in the background. Later executions in the session stay `cache-first`, exactly as
//      before, so navigating Home ⇄ detail costs no extra quota.
//   2. Nothing is written while incognito is on, and a storage that is being retired (account
//      switch) drops any late delta so the cleared database cannot be repopulated.

export const ANILIST_CACHE_DB = 'izumi-anilist-graphcache'
/** Days before an entry hydrated from disk is discarded by the default storage. */
export const ANILIST_CACHE_MAX_AGE_DAYS = 7

type PolicyOperation = Pick<Operation, 'kind' | 'key'> & {
  context: Pick<Operation['context'], 'requestPolicy'>
}

/** The policy override for `op`, or `null` to leave it untouched. Mutates `seen`. */
export function revalidatedPolicy(op: PolicyOperation, seen: Set<number>): 'cache-and-network' | null {
  if (op.kind !== 'query' || op.context.requestPolicy !== 'cache-first' || seen.has(op.key)) return null
  seen.add(op.key)
  return 'cache-and-network'
}

/** Sits in front of the cache exchange; see the module comment. */
export function revalidateOnceExchange(seen = new Set<number>()): Exchange {
  return mapExchange({
    onOperation(op) {
      const policy = revalidatedPolicy(op, seen)
      return policy ? makeOperation(op.kind, op, { ...op.context, requestPolicy: policy }) : op
    },
  })
}

/** `base` with its writes suppressed whenever `blocked()` is true (incognito, or retired). */
export function gatedStorage(base: StorageAdapter, blocked: () => boolean): StorageAdapter {
  return {
    ...base,
    writeData: (delta) => (blocked() ? Promise.resolve() : base.writeData(delta)),
  }
}

export interface AnilistPersistence {
  storage: StorageAdapter
  /** Stop persisting (late deltas are dropped) and wipe the database. */
  retire(): Promise<void>
}

/** IndexedDB-backed persistence, or `null` where IndexedDB does not exist (tests, SSR). */
export function createAnilistPersistence(blocked: () => boolean): AnilistPersistence | null {
  if (typeof indexedDB === 'undefined') return null
  const base = makeDefaultStorage({ idbName: ANILIST_CACHE_DB, maxAge: ANILIST_CACHE_MAX_AGE_DAYS })
  let retired = false
  return {
    storage: gatedStorage(base, () => retired || blocked()),
    async retire() {
      retired = true
      try {
        await base.clear()
      } catch {
        // A wipe that fails leaves at worst an expired-by-maxAge entry; never block the rebuild.
      }
    },
  }
}
