// Memo for the STABLE half of an online-stream resolve.
//
// Resolving one episode is three serial network hops per provider: search → findEpisodes →
// findEpisodeServer. The first two don't depend on the episode at all — searching for the show and
// listing its episodes gives the same answer for episode 1 and episode 12 — yet they were re-run on
// every picker open. With ~18 providers, and two passes each for dub-capable ones, that is the bulk
// of the wait.
//
// Deliberately NOT cached: findEpisodeServer. Those URLs are tokenized and time-limited, so a
// cached one plays once and 403s later.
//
// No dependencies here on purpose: both the extension manager (to invalidate) and the resolver (to
// read) import this, and a shared leaf module keeps that from becoming an import cycle.

const DEFAULT_TTL_MS = 10 * 60 * 1000

interface Entry {
  at: number
  promise: Promise<unknown>
}

const store = new Map<string, Entry>()

/**
 * Run `load` at most once per `key` per TTL window, sharing the in-flight promise so concurrent
 * callers (the dub and sub passes, or a re-opened picker) collapse into one request.
 *
 * `cacheable` decides whether a settled value is worth keeping. A failed call must not stick:
 * providers return `null` on timeout, and caching that would blank the provider for the whole TTL.
 * An empty ARRAY is kept, though — a provider that genuinely doesn't carry the show should not be
 * re-queried for every episode.
 */
export function memo<T>(key: string, load: () => Promise<T>, cacheable: (v: T) => boolean, ttlMs = DEFAULT_TTL_MS): Promise<T> {
  const hit = store.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return hit.promise as Promise<T>
  const promise = load().then(
    (v) => { if (!cacheable(v)) store.delete(key); return v },
    (e) => { store.delete(key); throw e },
  )
  store.set(key, { at: Date.now(), promise })
  return promise
}

/** Drop everything. Called when the extension set is rebuilt, so a provider that was reconfigured,
 *  updated or disabled can't serve answers from its previous incarnation. */
export function clearProviderCache(): void {
  store.clear()
}

/** Entry count — for tests and diagnostics. */
export const providerCacheSize = (): number => store.size

/** An array result is worth caching even when empty; anything else (a null from a failed or
 *  timed-out call) is not. */
export const cacheableList = (v: unknown): boolean => Array.isArray(v)
