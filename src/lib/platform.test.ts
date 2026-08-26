import { describe, expect, it } from 'vitest'
import { isAndroidUiPreview, isAndroidUiPreviewShortcut } from './platform'

describe('Android UI preview', () => {
  it('only accepts the explicit Android preview in development', () => {
    expect(isAndroidUiPreview('?preview=android', true)).toBe(true)
    expect(isAndroidUiPreview('?preview=desktop', true)).toBe(false)
    expect(isAndroidUiPreview('?preview=android', false)).toBe(false)
  })

  it('reserves Ctrl+Shift+A for the debug-client preview toggle', () => {
    const shortcut = { key: 'A', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, repeat: false }
    expect(isAndroidUiPreviewShortcut(shortcut, true)).toBe(true)
    expect(isAndroidUiPreviewShortcut({ ...shortcut, repeat: true }, true)).toBe(false)
    expect(isAndroidUiPreviewShortcut(shortcut, false)).toBe(false)
  })
})
