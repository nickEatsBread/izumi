import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const plugin = readFileSync(fileURLToPath(new URL(
  '../../../src-tauri/tauri-plugin-mpv/android/src/main/java/app/izumi/mpv/MpvPlugin.kt',
  import.meta.url,
)), 'utf8')

describe('Android mpv quality presets', () => {
  it('stores the frontend render set and applies it at core init', () => {
    expect(plugin).toContain('fun setRenderOpts')
    expect(plugin).toContain('storedRenderOpts')
    expect(plugin).toContain('for ((k, v) in storedRenderOpts)')
    expect(plugin).toContain('m.setOptionString(k, v)')
  })

  it('does not force an FBO format on GLES', () => {
    expect(plugin).not.toMatch(/setOptionString\(\s*"fbo-format"/)
  })
})
