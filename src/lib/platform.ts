import { writable, get } from 'svelte/store'
import { platform } from '@tauri-apps/plugin-os'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { LogicalSize, PhysicalSize } from '@tauri-apps/api/dpi'
import { androidTvMode, type AndroidTvMode } from '$lib/settings/ui'

/** True on the Android build. Resolved once at boot; false everywhere the OS plugin call fails
 *  (plain web / SSR). Drives the playback + nav branches. */
export const isAndroid = writable(false)
/** Native macOS window chrome differs materially from the frameless Windows/Linux shell. */
export const isMacOS = writable(false)
/** Windows-only playback features must not leak onto macOS/Linux through broad desktop gates. */
export const isWindows = writable(false)
/** Use the mobile layout: Android OR a narrow viewport. */
export const isMobile = writable(false)
/** Android television/streaming-box layout: remote-first chrome and ten-foot focus treatment. */
export const isAndroidTv = writable(false)
/** Any supported television runtime. Keep TV layout policy separate from the underlying OS. */
export const isTv = writable(false)
/** True only while the development build is impersonating Android for UI testing. */
export const androidUiPreview = writable(false)

let nativeAndroid = false
let mobileQuery: MediaQueryList | null = null
let previewShortcutAttached = false
let desktopWindowState: { width: number; height: number; maximized: boolean } | null = null
let tvPreview = false
let tvModeSubscribed = false
let platformInitialized = false

export function detectAndroidTvUserAgent(userAgent: string): boolean {
  return /IzumiTV\/|Android TV|GoogleTV|BRAVIA|SHIELD Android TV|SMART-TV|\bAFT[A-Z0-9]+\b/i.test(userAgent)
}

export function hasTauriRuntime(): boolean {
  return typeof window !== 'undefined'
    && !!(window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
}

export function resolveAndroidTv(
  android: boolean,
  mode: AndroidTvMode,
  userAgent: string,
  preview = false,
): boolean {
  if (!android || mode === 'off') return false
  return mode === 'on' || preview || detectAndroidTvUserAgent(userAgent)
}

const syncPlatformStores = () => {
  const android = nativeAndroid || get(androidUiPreview)
  const androidTelevision = resolveAndroidTv(
    android,
    get(androidTvMode),
    typeof navigator === 'undefined' ? '' : navigator.userAgent,
    tvPreview,
  )
  isAndroid.set(android)
  isAndroidTv.set(androidTelevision)
  isTv.set(androidTelevision)
  isMobile.set(!androidTelevision && (android || !!mobileQuery?.matches))
}

/** Allow the live Vite UI to expose Android-only settings without an emulator. Kept behind DEV so
 *  a query parameter can never change platform behaviour in a packaged build. */
export function isAndroidUiPreview(search: string, dev = import.meta.env.DEV) {
  const preview = new URLSearchParams(search).get('preview')
  return dev && (preview === 'android' || preview === 'tv')
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
  if (platformInitialized) {
    syncPlatformStores()
    return
  }
  platformInitialized = true
  try {
    const current = platform()
    nativeAndroid = current === 'android'
    isMacOS.set(current === 'macos')
    isWindows.set(current === 'windows')
  } catch {
    /* not running under Tauri (web/SSR) — stays false */
  }
  if (typeof window !== 'undefined') {
    androidUiPreview.set(isAndroidUiPreview(window.location.search))
    tvPreview = import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === 'tv'
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
  if (!tvModeSubscribed) {
    tvModeSubscribed = true
    androidTvMode.subscribe(syncPlatformStores)
  }
  syncPlatformStores()
}
