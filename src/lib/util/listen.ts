import { listen, type EventCallback, type UnlistenFn } from '@tauri-apps/api/event'

/** `listen()` registration is an async IPC round-trip, so the plain pattern
 *  (`.then((u) => (un = u))` + `return () => un?.()`) loses the unsubscriber when the
 *  owner tears down before the promise resolves — the handler then leaks and stacks up
 *  across remounts. This returns a cleanup fn that is safe to call at any time: early
 *  cleanup drops the listener the moment registration lands. */
export function listenSafe<T>(event: string, handler: EventCallback<T>): () => void {
  let un: UnlistenFn | null = null
  let dead = false
  listen<T>(event, handler)
    .then((u) => {
      if (dead) u()
      else un = u
    })
    .catch(() => { /* webview teardown mid-registration — nothing to unhook */ })
  return () => {
    dead = true
    un?.()
    un = null
  }
}
