import { get, writable } from 'svelte/store'
import { invoke } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { openUrl } from '@tauri-apps/plugin-opener'
import { isAndroid } from '$lib/platform'
import { updateChannel } from '$lib/settings/ui'
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
    // flatpak — Phase 1: route to the release page (Phase 2 replaces this with the portal flow)
    await openUrl(RELEASES)
  } catch (e) { updateError.set(String(e)); updatePhase.set('error') }
}
