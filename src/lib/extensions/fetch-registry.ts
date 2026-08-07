/** In-flight bridged extension fetches + a cancellation epoch for multi-step bridge calls.
 *
 * Extension HTTP is issued by worker code the host cannot reach into, so cancellation lives
 * here on the main thread: aborting the controllers cancels the native reqwest futures
 * (freeing their lane permits), and bumping the epoch tells multi-step JVM calls to stop
 * before their NEXT step. Collateral is accepted and bounded: a concurrent background
 * consumer (auto-download resolve) may lose its extension fetches and simply yields
 * whatever folded in before the cut. */
const inflight = new Set<AbortController>()
let epoch = 0

export function trackFetch(): { controller: AbortController; done: () => void } {
  const controller = new AbortController()
  inflight.add(controller)
  return { controller, done: () => inflight.delete(controller) }
}

export function cancelExtensionFetches(): void {
  epoch++
  for (const c of inflight) c.abort()
  inflight.clear()
}

export const fetchEpoch = () => epoch
