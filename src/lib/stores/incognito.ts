import { get, writable } from 'svelte/store'

// Incognito mode: a session-only privacy switch. While it is on, nothing about what you watch
// leaves the session — no tracker pushes (AniList/MAL), no persisted history/positions/source
// memory, no recent searches, and the OS/Discord presence goes private. Watching still works
// normally INSIDE the session: incognito plays land in in-memory overlay stores that the normal
// read paths (Continue Watching, episode lists, resume) merge in, and those overlays are purged
// when the mode is turned off. Deliberately never persisted — a restart always starts clean.

/** Whether incognito mode is active. Toggle via enter/exitIncognito, not .set, so the purge runs. */
export const incognito = writable<boolean>(false)

// Overlay stores register a purge callback at module load (same injection idiom as the tracker
// queue's registerReplay) — this module stays dependency-free so anything can import the flag
// without creating a cycle.
const purgeFns: Array<() => void> = []

/** Register a callback that wipes one incognito overlay store. Called on exit. */
export function onIncognitoPurge(fn: () => void): void {
  purgeFns.push(fn)
}

/** Enter incognito mode. */
export function enterIncognito(): void {
  incognito.set(true)
}

/** Leave incognito mode and discard everything the session accumulated. */
export function exitIncognito(): void {
  incognito.set(false)
  for (const fn of purgeFns) fn()
}

/** Flip the mode (UI toggles). Exiting purges. */
export function toggleIncognito(): void {
  if (get(incognito)) exitIncognito()
  else enterIncognito()
}
