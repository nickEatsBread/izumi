import { describe, expect, it } from 'vitest'
import { detectAndroidTvUserAgent, isAndroidUiPreview, isAndroidUiPreviewShortcut, isWebKitGtk, resolveAndroidTv } from './platform'

describe('isWebKitGtk', () => {
  it('matches the Linux WebKitGTK webview only, never a Chromium engine', () => {
    // The Steam Deck's izumi (GNOME 50 runtime), read from the device.
    expect(isWebKitGtk('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/60.5 Safari/605.1.15')).toBe(true)
    // CEF on Linux, WebView2 on Windows, Android WebView.
    expect(isWebKitGtk('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36')).toBe(false)
    expect(isWebKitGtk('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0')).toBe(false)
    expect(isWebKitGtk('Mozilla/5.0 (Linux; Android 14; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/142.0.0.0 Mobile Safari/537.36')).toBe(false)
    // macOS WKWebView is WebKit but not WebKitGTK.
    expect(isWebKitGtk('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)')).toBe(false)
    expect(isWebKitGtk('')).toBe(false)
  })
})

describe('Android UI preview', () => {
  it('only accepts the explicit Android preview in development', () => {
    expect(isAndroidUiPreview('?preview=android', true)).toBe(true)
    expect(isAndroidUiPreview('?preview=tv', true)).toBe(true)
    expect(isAndroidUiPreview('?preview=desktop', true)).toBe(false)
    expect(isAndroidUiPreview('?preview=android', false)).toBe(false)
  })

  it('detects native and common Android TV user-agent markers', () => {
    expect(detectAndroidTvUserAgent('Android 14; IzumiTV/1')).toBe(true)
    expect(detectAndroidTvUserAgent('Mozilla/5.0 (Linux; Android 12; AFTMM Build/PS)')).toBe(true)
    expect(detectAndroidTvUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 9)')).toBe(false)
  })

  it('supports automatic detection and explicit overrides only on Android', () => {
    expect(resolveAndroidTv(true, 'auto', 'IzumiTV/1')).toBe(true)
    expect(resolveAndroidTv(true, 'off', 'IzumiTV/1')).toBe(false)
    expect(resolveAndroidTv(true, 'on', 'ordinary Android')).toBe(true)
    expect(resolveAndroidTv(false, 'on', 'IzumiTV/1')).toBe(false)
  })

  it('reserves Ctrl+Shift+A for the debug-client preview toggle', () => {
    const shortcut = { key: 'A', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, repeat: false }
    expect(isAndroidUiPreviewShortcut(shortcut, true)).toBe(true)
    expect(isAndroidUiPreviewShortcut({ ...shortcut, repeat: true }, true)).toBe(false)
    expect(isAndroidUiPreviewShortcut(shortcut, false)).toBe(false)
  })
})
