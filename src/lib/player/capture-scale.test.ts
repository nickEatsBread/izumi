import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// CDP clip/scale mutates the live window. Screenshots capture the full compositor
// surface and crop in JS. Encrypted GIFs capture in Rust and crop there.
// In-document OSD is hidden for the file.

const drm = readFileSync(fileURLToPath(new URL('../components/player/DrmSurface.svelte', import.meta.url)), 'utf8')
const overlay = readFileSync(fileURLToPath(new URL('../components/player/PlayerOverlay.svelte', import.meta.url)), 'utf8')
const native = readFileSync(fileURLToPath(new URL('./native.ts', import.meta.url)), 'utf8')
const rust = readFileSync(fileURLToPath(new URL('../../../src-tauri/src/lib.rs', import.meta.url)), 'utf8')

describe('compositor capture', () => {
  it('does not persist a chrome-hide class on the live player', () => {
    expect(drm).not.toContain('izumi-drm-shot')
    expect(overlay).not.toContain('shotHide')
    expect(overlay).not.toContain('openPlayerHud')
    expect(overlay).toContain('izumi-hud')
    expect(drm).not.toContain('hud-host')
    expect(drm).not.toContain('player_hud_set_visible')
    expect(rust).not.toContain('player_hud_set_visible')
    expect(rust).not.toContain('get_webview("main")')
  })

  it('does not use a CDP clip that zooms the live video', () => {
    expect(drm).not.toContain('capture_webview_jpeg_clip')
    expect(rust).not.toContain('capture_webview_jpeg_clip')
    expect(drm).toContain("invoke<unknown>('capture_webview_jpeg'")
    expect(rust).toContain('async fn capture_webview_jpeg(')
    expect(rust).toContain('Do not pass a CDP `clip`')
  })

  it('records encrypted GIFs from a native compositor loop', () => {
    expect(drm).toContain('encodeVideoFrame')
    expect(drm).toContain('concealCaptureChrome')
    expect(drm).toContain('cropX')
    expect(drm).toContain("invoke('drm_gif_start'")
    expect(drm).not.toContain('recordGifFrames')
    expect(drm).toContain("invoke<unknown>('capture_webview_jpeg'")
    expect(overlay).not.toContain('Stop GIF')
    expect(drm).not.toContain('Math.max(20, remaining)')
    expect(native).toContain('player_capture_segment')
    expect(native).not.toContain('fps: plan.fps')
  })

  it('keeps chrome hidden until compositor capture has finished', () => {
    const stop = drm.slice(drm.indexOf('async function gifStop'))
    expect(stop.indexOf("invoke('drm_gif_stop')")).toBeGreaterThan(-1)
    expect(stop.indexOf("invoke('drm_gif_stop')")).toBeLessThan(stop.indexOf('finishGifUi()'))
    expect(overlay).toContain('izumi-player-root')
  })
})
