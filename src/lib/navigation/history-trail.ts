import { isSettingsPath } from '$lib/settings/hierarchy'

// Which page each history entry of this tab holds, keyed by SvelteKit's own entry index, so Back can
// tell "the page to return to is the previous entry" (history.back()) from "it is somewhere else"
// (replace). SvelteKit keeps the index in history.state and restores it on a reload
// (runtime/client/client.js), and the trail is kept in sessionStorage, so the reloads after a
// profile switch or a backup restore keep it too. Written from the app layout's afterNavigate.

/** SvelteKit's history-state key for the entry index (@sveltejs/kit runtime/client/constants.js). */
export const HISTORY_INDEX = 'sveltekit:history'
export const TRAIL_STORAGE_KEY = 'izumi:nav-trail:v1'
export const TRAIL_CAP = 100

interface Trail {
  /** The index recorded last (the page on screen), or null before the first navigation. */
  index: number | null
  /** history index → pathname + search */
  entries: Record<string, string>
  /** The last page outside Settings before Settings was entered. */
  origin: string | null
  /** The page recorded last, to notice a navigation that enters Settings. */
  current: string | null
}

let trail: Trail | null = null

const emptyTrail = (): Trail => ({ index: null, entries: {}, origin: null, current: null })

function load(): Trail {
  if (trail) return trail
  const loaded = emptyTrail()
  try {
    const raw = sessionStorage.getItem(TRAIL_STORAGE_KEY)
    const saved = raw ? (JSON.parse(raw) as Partial<Trail> | null) : null
    if (saved && typeof saved === 'object') {
      for (const [key, path] of Object.entries(saved.entries ?? {})) {
        if (Number.isFinite(Number(key)) && typeof path === 'string') loaded.entries[key] = path
      }
      if (typeof saved.index === 'number' && Number.isFinite(saved.index)) loaded.index = saved.index
      if (typeof saved.origin === 'string') loaded.origin = saved.origin
      if (typeof saved.current === 'string') loaded.current = saved.current
    }
  } catch {
    // Storage unavailable or a corrupt value: start a fresh trail.
  }
  trail = loaded
  return loaded
}

function persist(state: Trail): void {
  try { sessionStorage.setItem(TRAIL_STORAGE_KEY, JSON.stringify(state)) } catch { /* unavailable */ }
}

/** SvelteKit's entry index in `state` (default history.state), or null. */
export function historyIndex(state: unknown = typeof history === 'undefined' ? null : history.state): number | null {
  const value = state !== null && typeof state === 'object' ? (state as Record<string, unknown>)[HISTORY_INDEX] : undefined
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** The index of the page on screen while history sits on the entry recorded last. A shallow entry
 *  pushed since (the source picker's Back trap) or an unrecorded one makes every answer unknown. */
function currentIndex(state: Trail): number | null {
  const live = historyIndex()
  return live !== null && live === state.index ? live : null
}

/** Record the page a navigation landed on (the app layout's afterNavigate: `to.url.pathname +
 *  to.url.search` and `navigation.type`). */
export function recordTrail(path: string, navigationType: string): void {
  const index = historyIndex()
  if (index === null) return
  const state = load()
  // A pushed or replaced page cuts off everything forward of it; a history step keeps it.
  if (navigationType !== 'popstate') {
    for (const key of Object.keys(state.entries)) if (Number(key) > index) delete state.entries[key]
  }
  if (isSettingsPath(path) && state.current !== null && !isSettingsPath(state.current)) state.origin = state.current
  state.entries[index] = path
  state.index = index
  state.current = path
  const keys = Object.keys(state.entries).map(Number).sort((a, b) => a - b)
  for (const key of keys.slice(0, Math.max(0, keys.length - TRAIL_CAP))) delete state.entries[key]
  persist(state)
}

/** The page one history step back, or null when unknown (a gap, an unrecorded entry). */
export function previousPath(): string | null {
  const state = load()
  const index = currentIndex(state)
  return index === null ? null : state.entries[index - 1] ?? null
}

/** The smallest n >= 1 whose page n steps back matches, walking back through recorded entries
 *  only; a gap before a match answers null. */
export function stepsBackTo(match: (path: string) => boolean): number | null {
  const state = load()
  const index = currentIndex(state)
  if (index === null) return null
  for (let steps = 1; steps <= TRAIL_CAP; steps++) {
    const path = state.entries[index - steps]
    if (path === undefined) return null
    if (match(path)) return steps
  }
  return null
}

/** The last page outside Settings before Settings was entered, or null. */
export function settingsOrigin(): string | null {
  return load().origin
}

export function resetHistoryTrail(): void {
  trail = emptyTrail()
  try { sessionStorage.removeItem(TRAIL_STORAGE_KEY) } catch { /* unavailable */ }
}
