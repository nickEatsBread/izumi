import { invoke } from '@tauri-apps/api/core'
import { hasTauriRuntime } from '$lib/platform'
import { isLibraryCollection } from '$lib/storage/library-db'
import { createBackup, parseBackup, restoreBackup, type AppBackup } from '$lib/backup'

/**
 * Keeps a durable copy of preferences on disk, because `localStorage` is not durable storage.
 *
 * Every setting in the app lives in the webview's `localStorage` and nowhere else. Both WKWebView
 * and WebView2 class it as evictable: the OS reclaims it under disk pressure, a webview data
 * migration can drop it, and clearing website data removes it outright. None of that surfaces an
 * error — the app simply reopens having forgotten everything, and the only copy that existed was a
 * backup file the user had to remember to export by hand.
 *
 * So: mirror preferences to a real file (see `src-tauri/src/prefs_store.rs`), and put them back if
 * they ever vanish. The file is deliberately the same shape the manual Backup & restore page reads
 * and writes, so a snapshot doubles as an importable backup rather than a private second format.
 *
 * Secrets are excluded, reusing the manual backup's own rule. The snapshot is written without the
 * user asking, so it must not put access tokens and API keys in a plaintext file for anything with
 * read access to harvest. Settings come back after a wipe; sign-ins are entered again.
 */

export interface SnapshotMeta {
  path: string
  bytes: number
  savedAt: number | null
}

interface LoadedSnapshot extends SnapshotMeta {
  contents: string
  recoveredFromPrevious: boolean
}

/** Guards the reload below. Set before restoring, so a restore that does not stick cannot loop. */
const RESTORE_ATTEMPTED = 'izumi-prefs-restore-attempted'

/** Long enough to be free next to everything else the app writes, short enough that a crash loses
 *  at most one interaction's worth of settings. Changes also flush on hide, which covers quitting. */
const MIRROR_INTERVAL_MS = 30_000

/**
 * Written only by the mirror, and travels inside the snapshot so a restore puts it back.
 *
 * Its whole job is to be a key that nothing else in the app can recreate — see `storageLooksWiped`.
 */
export const SNAPSHOT_SENTINEL = 'izumi-prefs-snapshot-v1'

/** Pretty-printed on purpose: this file exists partly to be read. Opening it during development
 *  should show the user's settings, not one line needing a formatter. */
export function snapshotPayload(storage: Storage): string {
  // Stamp before capturing, so the sentinel is part of the payload and returns with a restore.
  if (storage.getItem(SNAPSHOT_SENTINEL) === null) storage.setItem(SNAPSHOT_SENTINEL, '1')
  return JSON.stringify(createBackup(storage, false), null, 2)
}

/**
 * True when a snapshot describes settings that are simply gone.
 *
 * Deliberately NOT "are the snapshot's own keys missing", which is the obvious test and is wrong.
 * Roughly 25 modules create `svelte-persisted-store` values at import time, and those stores write
 * their defaults straight into `localStorage` — all of it before this can run. After a real wipe
 * most snapshot keys are therefore already present again, holding defaults, and a presence test
 * reports healthy storage for storage that was just emptied. Measured on a wiped profile: 8 of 10
 * keys were back before the check, so the two the user had actually changed were lost for good.
 *
 * Nothing but the mirror writes the sentinel, so its absence beside a snapshot means the storage
 * those settings lived in is gone. It cannot misfire on a fresh install (no snapshot), after a
 * factory reset (deletes the snapshot with the config directory) or after a settings wipe (clears
 * both), and `storage.length === 0` is no use either — the locale is written before this runs.
 */
export function storageLooksWiped(storage: Storage, snapshot: AppBackup): boolean {
  // The sentinel does not count towards "has anything worth restoring": every snapshot carries one,
  // so counting it would make a snapshot of an empty profile look restorable and cost a reload.
  const restorable = Object.keys(snapshot.localStorage).filter(key => key !== SNAPSHOT_SENTINEL)
  if (!restorable.length) return false
  return storage.getItem(SNAPSHOT_SENTINEL) === null
}

export async function loadSnapshot(): Promise<LoadedSnapshot | null> {
  if (!hasTauriRuntime()) return null
  return (await invoke<LoadedSnapshot | null>('prefs_snapshot_load')) ?? null
}

export async function saveSnapshot(storage: Storage): Promise<SnapshotMeta | null> {
  if (!hasTauriRuntime()) return null
  return await invoke<SnapshotMeta>('prefs_snapshot_save', { contents: snapshotPayload(storage) })
}

export async function clearSnapshot(): Promise<void> {
  if (!hasTauriRuntime()) return
  await invoke('prefs_snapshot_clear')
}

/**
 * Put preferences back when webview storage has been wiped underneath the app.
 *
 * Returns true when it restored, and the caller reloads: the settings stores read `localStorage`
 * at import time, long before this can run, so they are already holding defaults. Reloading on a
 * rare recovery is a far smaller cost than racing module initialisation on every boot.
 */
export async function recoverPreferences(storage: Storage = localStorage): Promise<boolean> {
  if (!hasTauriRuntime()) return false
  try {
    // Set before the attempt, not after. If restoring cannot stick — storage is full, or the
    // webview is denying writes — the next boot must not try again and reload forever.
    if (sessionStorage.getItem(RESTORE_ATTEMPTED)) return false
    sessionStorage.setItem(RESTORE_ATTEMPTED, '1')
  } catch {
    return false
  }
  try {
    const loaded = await loadSnapshot()
    if (!loaded) return false
    const snapshot = parseBackup(loaded.contents)
    if (!storageLooksWiped(storage, snapshot)) return false
    await restoreBackup(storage, snapshot)
    // Snapshots written before the sentinel existed do not carry one, and restoring such a file
    // would leave storage still looking wiped — restoring and reloading again on every launch.
    storage.setItem(SNAPSHOT_SENTINEL, '1')
    return true
  } catch {
    // Recovery is best-effort by definition. A snapshot that cannot be read must never be the
    // reason the app fails to start.
    return false
  }
}

/**
 * Mirror preferences to disk until the returned function is called.
 *
 * Polls rather than wrapping `localStorage.setItem`: settings are written from ~25 modules through
 * `svelte-persisted-store`, and the `storage` event does not fire for same-document writes, so the
 * alternatives are patching a global or editing every store. Serialising a few tens of KB on an
 * interval and writing only on change costs less than either and cannot miss a writer.
 */
export function startPreferenceMirror(storage: Storage = localStorage): () => void {
  if (!hasTauriRuntime()) return () => {}
  let lastWritten = ''
  let stopped = false
  let inFlight = false

  const flush = async () => {
    if (stopped || inFlight) return
    let payload: string
    try { payload = snapshotPayload(storage) } catch { return }
    if (payload === lastWritten) return
    inFlight = true
    try {
      await invoke('prefs_snapshot_save', { contents: payload })
      lastWritten = payload
    } catch {
      // Leave `lastWritten` alone so the next tick retries instead of assuming this write landed.
    } finally {
      inFlight = false
    }
  }

  // Write once immediately. Without this a wipe during the first interval would find no snapshot
  // at all, which is precisely the install-then-crash case worth covering.
  void flush()
  const timer = setInterval(() => { void flush() }, MIRROR_INTERVAL_MS)
  // Hiding is the last reliable signal before the process goes away; `beforeunload` is not fired
  // in every webview teardown path.
  const onHide = () => { void flush() }
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', onHide)

  return () => {
    stopped = true
    clearInterval(timer)
    document.removeEventListener('visibilitychange', onHide)
    window.removeEventListener('pagehide', onHide)
  }
}

/**
 * Keys a settings-only wipe removes: everything except sign-ins and the library.
 *
 * Narrower than Settings → About → "Reset izumi to defaults", which deletes every app directory.
 * The common request is "put my settings back to stock" after a bad import or a theme experiment,
 * and answering it by signing the user out of every tracker and dropping their watch history makes
 * the control too dangerous to reach for. Secrets stay (still signed in), library collections stay
 * (they live in IndexedDB and are only mirrored into these keys by older builds).
 */
export function preferenceKeysToWipe(storage: Storage): string[] {
  const secret = /(token|secret|password|credential|api.?key|jwt|debrid|opensubtitles-creds|addon.*url)/i
  const keys: string[] = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (!key || secret.test(key) || isLibraryCollection(key)) continue
    keys.push(key)
  }
  return keys
}

/** Reset settings to defaults. Clears the snapshot too, or the next boot would restore them. */
export async function wipePreferences(storage: Storage = localStorage): Promise<number> {
  const keys = preferenceKeysToWipe(storage)
  for (const key of keys) storage.removeItem(key)
  await clearSnapshot()
  return keys.length
}
