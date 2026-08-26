import { writable, get } from 'svelte/store'
import { platform } from '@tauri-apps/plugin-os'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { LogicalSize, PhysicalSize } from '@tauri-apps/api/dpi'

/** True on the Android build. Resolved once at boot; false everywhere the OS plugin call fails
 *  (plain web / SSR). Drives the playback + nav branches. */
export const isAndroid = writable(false)
/** Native macOS window chrome differs materially from the frameless Windows/Linux shell. */
export const isMacOS = writable(false)
/** Use the mobile layout: Android OR a narrow viewport. */
export const isMobile = writable(false)
/** True only while the development build is impersonating Android for UI testing. */
export const androidUiPreview = writable(false)

let nativeAndroid = false
let mobileQuery: MediaQueryList | null = null
let previewShortcutAttached = false
let desktopWindowState: { width: number; height: number; maximized: boolean } | null = null

const syncPlatformStores = () => {
  const android = nativeAndroid || get(androidUiPreview)
  isAndroid.set(android)
  isMobile.set(android || !!mobileQuery?.matches)
}

/** Allow the live Vite UI to expose Android-only settings without an emulator. Kept behind DEV so
 *  a query parameter can never change platform behaviour in a packaged build. */
export function isAndroidUiPreview(search: string, dev = import.meta.env.DEV) {
  return dev && new URLSearchParams(search).get('preview') === 'android'
}

export function isAndroidUiPreviewShortcut(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey' | 'repeat'>,
  dev = import.meta.env.DEV,
) {
  return dev && !event.repeat && event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey
    && event.key.toLowerCase() === 'a'
}

/** Toggle the Android UI inside a running desktop debug client. This changes UI/platform gates only;
 *  Android-native playback, intents and haptics still require a device or emulator. */
export async function toggleAndroidUiPreview() {
  if (!import.meta.env.DEV || nativeAndroid) return
  const enabled = !get(androidUiPreview)
  androidUiPreview.set(enabled)
  syncPlatformStores()

  try {
    const appWindow = getCurrentWindow()
    if (enabled) {
      const [size, maximized] = await Promise.all([appWindow.outerSize(), appWindow.isMaximized()])
      desktopWindowState = { width: size.width, height: size.height, maximized }
      if (maximized) await appWindow.toggleMaximize()
      await appWindow.setMinSize(new LogicalSize(360, 560))
      await appWindow.setSize(new LogicalSize(390, 800))
    } else {
      await appWindow.setMinSize(new LogicalSize(900, 560))
      if (desktopWindowState) {
        await appWindow.setSize(new PhysicalSize(desktopWindowState.width, desktopWindowState.height))
        if (desktopWindowState.maximized) await appWindow.toggleMaximize()
      }
      desktopWindowState = null
    }
  } catch {
    // Plain-browser preview: the stores still switch even though there is no native window.
  }
}

/** Resolve the platform signals once at app start (called from the app layout boot effect). */
export function initPlatform() {
  try {
    const current = platform()
    nativeAndroid = current === 'android'
    isMacOS.set(current === 'macos')
  } catch {
    /* not running under Tauri (web/SSR) — stays false */
  }
  if (typeof window !== 'undefined') {
    androidUiPreview.set(isAndroidUiPreview(window.location.search))
    mobileQuery = window.matchMedia('(max-width: 640px)')
    mobileQuery.addEventListener('change', syncPlatformStores)
    if (import.meta.env.DEV && !previewShortcutAttached) {
      previewShortcutAttached = true
      window.addEventListener('keydown', (event) => {
        if (!isAndroidUiPreviewShortcut(event)) return
        event.preventDefault()
        void toggleAndroidUiPreview()
      })
    }
  }
  syncPlatformStores()
}
