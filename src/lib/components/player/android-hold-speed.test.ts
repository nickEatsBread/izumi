import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const player = readFileSync(fileURLToPath(new URL('./AndroidPlayer.svelte', import.meta.url)), 'utf8')
const plugin = readFileSync(
  fileURLToPath(
    new URL('../../../../src-tauri/tauri-plugin-mpv/android/src/main/java/app/izumi/mpv/MpvPlugin.kt', import.meta.url),
  ),
  'utf8',
)

describe('Android hold-to-2x feedback', () => {
  it('keeps one deliberate haptic at the moment 2x starts', () => {
    expect(player).toContain("gesture = 'hold'; heldSpeed = true; mpvCommand(['set', 'speed', '2']); haptic(15)")
  })

  it('does not let WebView turn the same hold into a native long-click', () => {
    expect(player).toContain('oncontextmenu={(e) => e.preventDefault()}')
    expect(plugin).toContain('webViewHapticsWereEnabled = web.isHapticFeedbackEnabled')
    expect(plugin).toContain('web.isHapticFeedbackEnabled = false')
  })

  it('restores the host WebView haptic setting after playback', () => {
    expect(plugin).toContain('webViewHapticsWereEnabled?.let { web.isHapticFeedbackEnabled = it }')
    expect(plugin).toContain('webViewHapticsWereEnabled = null')
  })
})
