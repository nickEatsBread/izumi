import { persisted } from 'svelte-persisted-store'
import { writable, get } from 'svelte/store'
import { online } from './online'

// Offline mode: a single flag consumed by the network screens via `{#if $offlineMode}`.
// The hard parts (downloads, local playback, local-first Continue Watching) already exist;
// this store just ties them into a coherent "mode". See the design spec.

/** User-forced offline mode (the settings toggle + the banner's "Switch to offline mode").
 *  Persisted so it survives restarts. */
export const forceOffline = persisted<boolean>('force-offline', false)
/** Effective offline mode. Set at boot + kept in sync by initOffline(). */
export const offlineMode = writable<boolean>(false)

export type OfflineEvent = 'boot' | 'force-change' | 'connectivity'

const nav = () => (typeof navigator !== 'undefined' ? navigator.onLine : true)

/**
 * Pure transition for the offline flag — no DOM, so the whole table is unit-testable.
 *  - force ⇒ always on (the toggle/banner latch).
 *  - boot / force-change: on iff physically offline.
 *  - connectivity: reconnect (online) ⇒ off; a drop (offline) does NOT auto-enter — the banner
 *    offers it — so we keep `prev`.
 */
export function nextOfflineMode(
  prev: boolean,
  { force, online, event }: { force: boolean; online: boolean; event: OfflineEvent },
): boolean {
  if (force) return true
  switch (event) {
    case 'boot':
    case 'force-change':
      return !online // launched / just-un-forced: reflect real connectivity
    case 'connectivity':
      return online ? false : prev // reconnect exits; a mid-session drop is not auto-entered
  }
}

let started = false
/** Wire the subscriptions once, at boot (called from +layout after initPlatform). */
export function initOffline(): void {
  if (started) return
  started = true
  offlineMode.set(nextOfflineMode(get(offlineMode), { force: get(forceOffline), online: nav(), event: 'boot' }))
  // Immediate-fire of subscribe() re-applies the same idempotent rules — safe.
  forceOffline.subscribe((force) =>
    offlineMode.update((prev) => nextOfflineMode(prev, { force, online: nav(), event: 'force-change' })),
  )
  online.subscribe((on) =>
    offlineMode.update((prev) => nextOfflineMode(prev, { force: get(forceOffline), online: on, event: 'connectivity' })),
  )
}

/** Enter offline mode (banner action). Latches via force so a reconnect won't yank you out. */
export function enterOfflineMode(): void {
  forceOffline.set(true)
}
/** Leave offline mode ("Go online"). Clears force; if still physically offline the force-change
 *  rule re-latches it on (an honest "you're still offline"). */
export function exitOfflineMode(): void {
  forceOffline.set(false)
}
