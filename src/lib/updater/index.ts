import { get, writable } from 'svelte/store'
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { isAndroid } from '$lib/platform'
import { gameMode } from '$lib/player/session'
import { updateChannel } from '$lib/settings/ui'
import { listenSafe } from '$lib/util/listen'
import { checkAndroidUpdate, downloadAndInstall, type UpdateInfo as AndroidUpdate } from './android'

export type UpdateTarget = 'android' | 'flatpak' | 'desktop'
export type Phase = 'idle' | 'available' | 'downloading' | 'ready' | 'error'
export type Available = { version: string; notes: string; target: UpdateTarget; android?: AndroidUpdate }

export const availableUpdate = writable<Available | null>(null)
export const updatePhase = writable<Phase>('idle')
/** 0..1 download fraction. Stays 0 while the download length is unknown (no Content-Length) —
 *  the toast shows an indeterminate bar in that case rather than a fake 0%. */
export const updateProgress = writable(0)
/** Bytes downloaded so far. The only honest readout when the total is unknown. */
export const updateBytes = writable(0)
export const updateError = writable('')
export const updateDismissed = writable(false)

/** Byte-counter payload emitted by the Rust download loops (desktop + Android). */
type ProgressPayload = { downloaded: number; total: number | null }

/** Map `update-download-progress` onto the progress stores for the duration of a download.
 *  Returns an unlisten fn. Desktop + Android both emit it; flatpak has its own portal event. */
function trackDownloadProgress(): () => void {
  return listenSafe<ProgressPayload>('update-download-progress', (e) => {
    const p = e.payload
    if (!p) return
    const downloaded = p.downloaded ?? 0
    updateBytes.set(downloaded)
    updateProgress.set(p.total && p.total > 0 ? Math.min(1, downloaded / p.total) : 0)
  })
}

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
const FLATPAK_ID = 'com.nicho.izumi'

/** Apply the pending update for the current target. Desktop/Android install in place; flatpak is
 *  handled in Phase 2 (portal) — until then it routes to the release page (current behavior). */
export async function applyUpdate(): Promise<void> {
  const u = get(availableUpdate); if (!u) return
  updateError.set('')
  updateProgress.set(0); updateBytes.set(0) // never carry a prior attempt's bar into this one
  try {
    if (u.target === 'android' && u.android) {
      updatePhase.set('downloading')
      const unlisten = trackDownloadProgress()
      try {
        await downloadAndInstall(u.android) // launches the system installer
        updateProgress.set(1)
      } finally { unlisten() }
      return
    }
    if (u.target === 'desktop') {
      updatePhase.set('downloading')
      // The install relaunches the app from Rust, so this invoke usually never resolves — the
      // listener dies with the process. Progress arrives on `update-download-progress` until then.
      const unlisten = trackDownloadProgress()
      try {
        await invoke('updater_install', { channel: get(updateChannel) }) // downloads + restarts
        updateProgress.set(1)
        updatePhase.set('ready')
      } finally { unlisten() }
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
      } catch (e) {
        // The portal refused (no update origin on a bundle install, or no portal backend). Do NOT
        // open a browser in Game mode: gamescope has no sensible browser target, so this either did
        // nothing or threw an unusable window over the game — which is what the user actually saw.
        // Show the reason plus the manual route instead, and keep the browser hop for Desktop mode
        // where there IS a browser.
        const reason = (e instanceof Error ? e.message : String(e)).trim()
        if (get(gameMode)) {
          updateError.set(
            `${reason || 'the Flatpak portal refused the update'}. `
            + `Switch to Desktop Mode and update izumi from Discover, or run: flatpak update ${FLATPAK_ID}`,
          )
          updatePhase.set('error')
        } else {
          await openUrl(RELEASES)
          updateDismissed.set(true)
          updatePhase.set('idle')
        }
      } finally {
        unlisten()
      }
    }
  } catch (e) { updateError.set(String(e)); updatePhase.set('error') }
}

const FIRST_DELAY = 5_000       // let first paint / boot settle
const INTERVAL = 6 * 60 * 60_000 // 6h

/** Kick off the initial (delayed) check + a 6h interval. Returns a stop fn. Checking is
 *  unconditional — there's no user opt-out — but applying an update stays opt-in via the toast.
 *  Callers gate this to packaged builds so dev never nags. */
export function startUpdateChecks(): () => void {
  let interval: ReturnType<typeof setInterval> | null = null
  const first = setTimeout(() => {
    void checkForUpdate()
    interval = setInterval(() => { void checkForUpdate() }, INTERVAL)
  }, FIRST_DELAY)
  return () => { clearTimeout(first); if (interval) clearInterval(interval) }
}
