import { writable } from 'svelte/store'
import type { StreamPickerState } from '$lib/player/session'
import type { ResolveSession } from '$lib/stremio/play'

// The two companion values the app shell's template reads, kept in a module with no runtime
// dependencies. The shell renders them before any TV has connected, and everything else in the
// companion graph (client, snapshot builders, playback, the source bridge and — through it — the
// whole stremio/play stack) loads later behind the boot-work queue.

/** The isolated picker a live TV request resolves through; `null` while no request is open. */
export const companionStreamPicker = writable<StreamPickerState | null>(null)

/** Same shape as `createResolveSession()` in stremio/play, inlined so the shell never imports it. */
export const companionResolveSession: ResolveSession = {
  abort: null,
  committed: new WeakSet<AbortController>(),
  local: false,
}
