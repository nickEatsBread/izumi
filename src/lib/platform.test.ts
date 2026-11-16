import { describe, expect, it } from 'vitest'
import { detectAndroidTvUserAgent, isAndroidUiPreview, isAndroidUiPreviewShortcut, resolveAndroidTv } from './platform'

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
