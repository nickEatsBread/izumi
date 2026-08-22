import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

describe('mpv quality architecture contracts', () => {
  it('does not force --fbo-format on any core (auto already prefers 16-bit float)', () => {
    for (const src of [
      read('../../../src-tauri/src/player/mod.rs'),
      read('../../../src-tauri/src/player/color_management.rs'),
      read('../../../src-tauri/tauri-plugin-mpv/android/src/main/java/app/izumi/mpv/MpvPlugin.kt'),
    ]) {
      expect(src).not.toMatch(/setOption(?:String)?\(\s*"fbo-format"/)
      expect(src).not.toMatch(/set_option\(\s*"fbo-format"/)
      expect(src).not.toMatch(/\("fbo-format"/)
    }
  })

  it('keeps the macOS embed on vo=libmpv OpenGL, not gpu-next/macvk', () => {
    const player = read('../../../src-tauri/src/player/mod.rs')
    const embed = read('../../../src-tauri/src/player/macos_embed.rs')
    expect(player).toContain('init.set_option("vo", "libmpv")')
    expect(player).toContain('gpu-next wants macvk/MoltenVK')
    expect(embed).toContain('OpenGL render API is the working embed path')
  })

  it('does not layer-back the macOS OpenGL view (that hides the framebuffer)', () => {
    const embed = read('../../../src-tauri/src/player/macos_embed.rs')
    expect(embed).not.toContain('view_as_view.setWantsLayer(true)')
    expect(embed).not.toContain('paint_black_layer')
    expect(embed).toContain('makeFirstResponder')
    expect(embed).toContain('_setDrawsBackground:')
    expect(embed).not.toContain('"drawsBackground"')
  })
})
