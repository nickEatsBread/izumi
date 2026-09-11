import { get, writable } from 'svelte/store'
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { isAndroid } from '$lib/platform'
import { androidMpvActive } from '$lib/player/android-mpv'
import { gameMode, playing } from '$lib/player/session'
import { updateChannel } from '$lib/settings/ui'
import { listenSafe } from '$lib/util/listen'
import { checkAndroidUpdate, downloadAndInstall, type UpdateInfo as AndroidUpdate } from './android'

export type UpdateTarget = 'android' | 'flatpak' | 'desktop'
export type Phase = 'idle' | 'available' | 'downloading' | 'ready' | 'error'
export type Available = {
  version: string
  notes: string
  target: UpdateTarget
  android?: AndroidUpdate
  channelSwitch?: 'stable' | 'beta'
}

export const availableUpdate = writable<Available | null>(null)
export const updatePhase = writable<Phase>('idle')
/** 0..1 download fraction. Stays 0 while the download length is unknown (no Content-Length) —
 *  the toast shows an indeterminate bar in that case rather than a fake 0%. */
export const updateProgress = writable(0)
/** Bytes downloaded so far. The only honest readout when the total is unknown. */
export const updateBytes = writable(0)
export const updateError = writable('')
export const updateDismissed = writable(false)
/** Version the user pushed away with "Later"/"Dismiss". The exported store stays a plain boolean
 *  for the UI; this module-local is what lets a NEWER release re-surface after an older one was
 *  dismissed — a "Later" belongs to that version, not to updating in general. */
let dismissedVersion: string | null = null
// The UI only flips the boolean, so this subscription is what snapshots the offered version at
// dismissal time (and forgets it when the dismissal is lifted).
updateDismissed.subscribe((dismissed) => {
  if (!dismissed) { dismissedVersion = null; return }
  const u = get(availableUpdate)
  if (u) dismissedVersion = u.version
})

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

/** Publish a detected update. A release DIFFERENT from the dismissed one re-surfaces the toast so
 *  a fresh offer isn't silently swallowed by a dismissal that targeted an older version. */
function publishAvailable(a: Available): void {
  if (get(updateDismissed) && dismissedVersion !== a.version) updateDismissed.set(false)
  availableUpdate.set(a)
  updatePhase.set('available')
}

/** Check the active channel for an update. Never throws — errors set updateError + leave phase idle. */
export async function checkForUpdate(): Promise<void> {
  updateError.set('') // clear any stale error from a prior failed check
  try {
    const target = await pickTarget()
    if (target === 'android') {
      const u = await checkAndroidUpdate()
      if (u) publishAvailable({ version: u.version, notes: u.notes, target, android: u })
      return
    }
    const channel = get(updateChannel)
    // Flatpak allows stable and beta to coexist as separate branches. Compare the running branch
    // as well as semantic versions: switching from a newer beta to stable is intentionally a
    // version downgrade, so a normal updater manifest check alone would incorrectly say current.
    const currentChannel = target === 'flatpak'
      ? invoke<string | null>('flatpak_current_channel').catch(() => null)
      : Promise.resolve<string | null>(null)
    const [r, flatpakChannel] = await Promise.all([
      invoke<{ version: string; current: string; notes: string | null } | null>(
        'updater_check', { channel }),
      currentChannel,
    ])
    if (target === 'flatpak' && flatpakChannel && flatpakChannel !== channel) {
      publishAvailable({
        version: r?.version ?? channel,
        notes: `Switch from the ${flatpakChannel} Flatpak channel to ${channel}. The change applies after you relaunch izumi.`,
        target,
        channelSwitch: channel,
      })
      return
    }
    if (r) publishAvailable({ version: r.version, notes: r.notes ?? '', target })
  } catch (e) { updateError.set(String(e)) }
}

const RELEASES = 'https://github.com/nickEatsBread/izumi/releases/latest'

/** Apply the pending update for the current target. Every target installs in place; Flatpak uses
 *  its update portal with a host-CLI fallback for older SteamOS portal implementations. */
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
    // Flatpak (Steam Deck) — Rust prefers the UpdateMonitor portal and falls back to a scoped host
    // `flatpak update` when SteamOS lacks that portal API. The new deploy takes effect on next
    // launch (no self-relaunch under gamescope). Portal progress arrives on this event.
    if (u.target === 'flatpak') {
      updatePhase.set('downloading')
      const unlisten = listenSafe<number>('flatpak-update-progress', (e) => updateProgress.set((e.payload ?? 0) / 100))
      try {
        await invoke('flatpak_update_install', { channel: get(updateChannel) })
        updateProgress.set(1)
        updatePhase.set('ready') // toast: quit + relaunch from Steam
      } catch (e) {
        // Rust already tried both the narrow update portal and the host Flatpak fallback. Do not
        // open a browser in Game mode: gamescope has no sensible browser target. Keep the backend
        // error in-app, with a short generic fallback only if it returned no detail.
        const reason = (e instanceof Error ? e.message : String(e)).trim()
        if (get(gameMode)) {
          updateError.set(reason || 'Automatic Flatpak update failed. Please try again.')
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
/** Floor for the opportunistic re-checks (playback exit, refocus): every check is a network round
 *  trip, so a burst of triggers must collapse into at most one real check. */
const RESURFACE_MIN_INTERVAL = 30 * 60_000

let lastCheckAt = 0

function runCheckNow(): void {
  lastCheckAt = Date.now()
  void checkForUpdate()
}

/** checkForUpdate, but only if the last actual check is older than `minIntervalMs`. The background
 *  re-surface triggers call this instead so they can fire freely without hammering the manifest. */
export function requestUpdateCheck(minIntervalMs = RESURFACE_MIN_INTERVAL): void {
  if (Date.now() - lastCheckAt < minIntervalMs) return
  runCheckNow()
}

/** Test hook: the scheduler holds module-local state (last-check time + dismissal memory); tests
 *  need a way back to a clean slate without reloading the module. */
export function __resetUpdateStateForTests(): void {
  lastCheckAt = 0
  dismissedVersion = null
  updateDismissed.set(false)
}

/** Kick off the initial (delayed) check + a 6h interval, and make sure a dismissed offer finds its
 *  way back: exiting playback or refocusing the window re-surfaces the toast and fires a
 *  rate-limited re-check. Those are the moments the user is actually looking at the app — a toast
 *  raised while they are inside the anime is one they never see. Checking is unconditional —
 *  there's no user opt-out — but applying an update stays opt-in via the toast. Callers gate this
 *  to packaged builds so dev never nags. Returns a stop fn that undoes every listener. */
export function startUpdateChecks(): () => void {
  let interval: ReturnType<typeof setInterval> | null = null
  const first = setTimeout(() => {
    runCheckNow()
    interval = setInterval(runCheckNow, INTERVAL)
  }, FIRST_DELAY)

  // true→false on either surface = the user clicked out of the anime back into the app. Both
  // stores can flip for the same exit (desktop player + Android mpv); the rate limit and the
  // idempotent dismissal reset make the duplicate exit harmless.
  let wasPlaying = false
  let wasMpvActive = false
  const onPlaybackExit = () => {
    if (get(availableUpdate) && get(updateDismissed)) updateDismissed.set(false)
    requestUpdateCheck()
  }
  const unsubPlaying = playing.subscribe((v) => {
    if (wasPlaying && !v) onPlaybackExit()
    wasPlaying = v
  })
  const unsubMpv = androidMpvActive.subscribe((v) => {
    if (wasMpvActive && !v) onPlaybackExit()
    wasMpvActive = v
  })

  // Refocusing (alt-tab back, unlocking the phone) is the other "user is looking" moment. The DOM
  // does not exist in the node test env, so registration is guarded rather than assumed; the flag
  // is captured once so stop() always mirrors exactly what was registered.
  const onVisibility = () => { if (document.visibilityState === 'visible') requestUpdateCheck() }
  const onFocus = () => requestUpdateCheck()
  const hasDom = typeof document !== 'undefined' && typeof window !== 'undefined'
  if (hasDom) {
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
  }

  return () => {
    clearTimeout(first)
    if (interval) clearInterval(interval)
    unsubPlaying()
    unsubMpv()
    if (hasDom) {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
    }
  }
}
