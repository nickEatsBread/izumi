import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { platform } from '@tauri-apps/plugin-os'
import { classifyStorageKey } from '$lib/storage/key-policy'
import { exportLibraryStorage, isLibraryCollection, restoreLibraryStorage } from '$lib/storage/library-db'
import { scheduleBootWork } from '$lib/util/boot-work'

/**
 * One-time move of a Linux install's data from the WebKitGTK build to the CEF build.
 *
 * The two engines keep separate profiles, so the last WebKitGTK release leaves this install's whole
 * profile in `engine-migration.json` in app data (`engine_migration_write`), and the first CEF
 * launch restores it (`engine_migration_take`, then `engine_migration_done` deletes the file).
 * Unlike an app backup it is the same device moving its own storage: secrets and device keys
 * (sync membership, TV pairing) move too, and no household grant is asked for. Only transient
 * keys stay behind.
 */
export interface EngineMigration {
  app: 'izumi'
  kind: 'engine-migration'
  version: 1
  localStorage: Record<string, string>
}

/** Set once a profile has taken in a migration, so a downgrade and upgrade can never overwrite
 *  newer settings with an old export. */
export const ENGINE_MIGRATED_KEY = 'izumi-engine-migrated'

function entries(storage: Storage): Record<string, string> {
  const values: Record<string, string> = {}
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    const value = key == null ? null : storage.getItem(key)
    if (key != null && value != null) values[key] = value
  }
  return values
}

/** The WebKitGTK side: this install's localStorage plus the library database. */
export async function buildEngineMigration(storage: Storage): Promise<EngineMigration> {
  // Same precedence as an app backup: a legacy localStorage value wins over the database copy.
  const values = { ...await exportLibraryStorage(), ...entries(storage) }
  for (const key of Object.keys(values)) if (classifyStorageKey(key) === 'transient') delete values[key]
  return { app: 'izumi', kind: 'engine-migration', version: 1, localStorage: values }
}

/** The WebKitGTK side: replace the file the first CEF launch takes in with the current state. */
export async function writeEngineMigration(storage: Storage): Promise<void> {
  await invoke('engine_migration_write', { json: JSON.stringify(await buildEngineMigration(storage)) })
}

const WRITE_EVERY_MS = 5 * 60_000
const CLOSE_WAIT_MS = 2_000

/** Linux WebKitGTK only: keep the migration file current after boot, every few minutes, and on
 *  window close, so the CEF update finds this install's latest state whenever it lands. Never
 *  throws; returns a stop function. */
export function startEngineMigrationWriter(storage: Storage): () => void {
  let linux = false
  try { linux = platform() === 'linux' } catch { /* not under Tauri */ }
  // The CEF build only reads the file: a Chromium profile must never overwrite the WebKitGTK one.
  if (!linux || navigator.userAgent.includes('Chrome/')) return () => {}
  const write = () => writeEngineMigration(storage).catch((error) => console.warn('[engine-migration]', error))
  void scheduleBootWork('engine-migration', write, 10_000)
  const timer = setInterval(write, WRITE_EVERY_MS)
  // Tauri closes the window only after this handler settles, so it must resolve, and quickly.
  const unlisten = getCurrentWindow().onCloseRequested(() =>
    Promise.race([write(), new Promise<void>((resolve) => setTimeout(resolve, CLOSE_WAIT_MS))]))
    .catch(() => () => {})
  return () => {
    clearInterval(timer)
    void unlisten.then((stop) => stop())
  }
}

function parseEngineMigration(text: string): EngineMigration {
  const value = JSON.parse(text) as Partial<EngineMigration>
  const stored = value?.localStorage
  if (value?.app !== 'izumi' || value.kind !== 'engine-migration' || value.version !== 1
    || !stored || typeof stored !== 'object' || Array.isArray(stored)
    || Object.values(stored).some((item) => typeof item !== 'string')) {
    throw new Error('Not an izumi engine migration.')
  }
  return value as EngineMigration
}

/** The CEF side, at startup: restore a waiting migration into this profile. Returns true when it
 *  restored one; the caller reloads so every store reads the restored values. */
export async function importEngineMigration(storage: Storage): Promise<boolean> {
  if (storage.getItem(ENGINE_MIGRATED_KEY)) return false
  const text = await invoke<string | null>('engine_migration_take').catch(() => null)
  if (!text) return false
  const migration = parseEngineMigration(text)
  for (const [key, value] of Object.entries(migration.localStorage)) {
    if (classifyStorageKey(key) === 'transient') continue
    if (isLibraryCollection(key)) storage.removeItem(key)
    else storage.setItem(key, value)
  }
  await restoreLibraryStorage(migration.localStorage)
  storage.setItem(ENGINE_MIGRATED_KEY, String(Date.now()))
  // A file left behind is harmless now: the marker stops a second import.
  await invoke('engine_migration_done').catch(() => {})
  return true
}
