import { get, writable } from 'svelte/store'
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { isAndroid } from '$lib/platform'
import { updateChannel } from '$lib/settings/ui'
import { listenSafe } from '$lib/util/listen'
import { checkAndroidUpdate, downloadAndInstall, type UpdateInfo as AndroidUpdate } from './android'

export type UpdateTarget = 'android' | 'flatpak' | 'desktop'
export type Phase = 'idle' | 'available' | 'downloading' | 'ready' | 'error'
export type Available = { version: string; notes: string; target: UpdateTarget; android?: AndroidUpdate }

export const availableUpdate = writable<Available | null>(null)
export const updatePhase = writable<Phase>('idle')
export const updateProgress = writable(0) // 0..1, download %
export const updateError = writable('')
export const updateDismissed = writable(false)

/** Which install mechanism applies to THIS build. */
export async function pickTarget(): Promise<UpdateTarget> {
  if (get(isAndroid)) return 'android'
  try { if (await invoke<boolean>('is_flatpak')) return 'flatpak' } catch { /* desktop */ }
  return 'desktop'
}

/** Check the active channel for an update. Never throws — errors set updateError + leave phase idle. */
export async function checkForUpdate(): Promise<void> {
  updateError.set('') // clear any stale error from a prior failed check
  try {
    const target = await pickTarget()
    if (target === 'android') {
      const u = await checkAndroidUpdate()
      if (u) { availableUpdate.set({ version: u.version, notes: u.notes, target, android: u }); updatePhase.set('available') }
      return
    }
    // desktop + flatpak both use the Rust `updater_check` (a plain manifest/version check that
    // works inside the sandbox — only the *install* differs by target).
    const r = await invoke<{ version: string; current: string; notes: string | null } | null>(
      'updater_check', { channel: get(updateChannel) })
    if (r) { availableUpdate.set({ version: r.version, notes: r.notes ?? '', target }); updatePhase.set('available') }
  } catch (e) { updateError.set(String(e)) }
}

const RELEASES = 'https://github.com/nickEatsBread/izumi/releases/latest'

/** Apply the pending update for the current target. Desktop/Android install in place; flatpak is
 *  handled in Phase 2 (portal) — until then it routes to the release page (current behavior). */
export async function applyUpdate(): Promise<void> {
  const u = get(availableUpdate); if (!u) return
  updateError.set('')
  try {
    if (u.target === 'android' && u.android) {
      updatePhase.set('downloading')
      await downloadAndInstall(u.android) // launches the system installer
      return
    }
    if (u.target === 'desktop') {
      updatePhase.set('downloading')
      await invoke('updater_install', { channel: get(updateChannel) }) // downloads + restarts
      updatePhase.set('ready')
      return
    }
    // flatpak (Steam Deck) — apply via the org.freedesktop.portal.Flatpak UpdateMonitor. It swaps
    // the deploy atomically; the new version takes effect on next launch (no self-relaunch under
    // gamescope). Progress arrives on the `flatpak-update-progress` event.
    if (u.target === 'flatpak') {
      updatePhase.set('downloading')
      const unlisten = listenSafe<number>('flatpak-update-progress', (e) => updateProgress.set((e.payload ?? 0) / 100))
      try {
        await invoke('flatpak_update_install')
        updateProgress.set(1)
        updatePhase.set('ready') // toast: quit + relaunch from Steam
      } catch {
        // No update origin (offline-bundle install) or the portal is unavailable — send the user to
        // the release page to reinstall from the .flatpakref.
        await openUrl(RELEASES)
        updateDismissed.set(true)
        updatePhase.set('idle')
      } finally {
        unlisten()
      }
    }
  } catch (e) { updateError.set(String(e)); updatePhase.set('error') }
}

const FIRST_DELAY = 5_000       // let first paint / boot settle
const INTERVAL = 6 * 60 * 60_000 // 6h

/** Kick off the initial (delayed) check + a 6h interval. Returns a stop fn. `autoEnabled` is read
 *  each tick so toggling the setting takes effect without a restart. Callers gate to packaged builds. */
export function startUpdateChecks(autoEnabled: () => boolean): () => void {
  let interval: ReturnType<typeof setInterval> | null = null
  const first = setTimeout(() => {
    if (autoEnabled()) void checkForUpdate()
    interval = setInterval(() => { if (autoEnabled()) void checkForUpdate() }, INTERVAL)
  }, FIRST_DELAY)
  return () => { clearTimeout(first); if (interval) clearInterval(interval) }
}
