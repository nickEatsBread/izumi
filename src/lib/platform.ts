import { writable, get } from 'svelte/store'
import { platform } from '@tauri-apps/plugin-os'

/** True on the Android build. Resolved once at boot; false everywhere the OS plugin call fails
 *  (plain web / SSR). Drives the playback + nav branches. */
export const isAndroid = writable(false)
/** Native macOS window chrome differs materially from the frameless Windows/Linux shell. */
export const isMacOS = writable(false)
/** Use the mobile layout: Android OR a narrow viewport. */
export const isMobile = writable(false)

/** Resolve the platform signals once at app start (called from the app layout boot effect). */
export function initPlatform() {
  try {
    const current = platform()
    isAndroid.set(current === 'android')
    isMacOS.set(current === 'macos')
  } catch {
    /* not running under Tauri (web/SSR) — stays false */
  }
  const mq = typeof window !== 'undefined' ? window.matchMedia('(max-width: 640px)') : null
  const sync = () => isMobile.set(get(isAndroid) || !!mq?.matches)
  sync()
  mq?.addEventListener('change', sync)
}
