import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// CDP clip/scale mutates the live window. Fast screenshots and GIFs capture the
// compositor in Rust and crop there without changing in-document chrome.

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
    expect(drm).toContain("invoke('capture_player_surface'")
    expect(rust).toContain('capture_webview_preview(&webview).await')
    expect(rust).toContain('crop_compositor_frame')
    expect(rust).toContain('async fn capture_webview_jpeg(')
    expect(rust).toContain('Do not pass a CDP `clip`')
  })

  it('captures protected playback without trying a decoded video frame first', () => {
    expect(drm).not.toContain('encodeVideoFrame')
    expect(drm).toContain('async function screenshot(fast = false)')
    expect(drm).toContain('if (fast) await persist()')
    expect(drm).toContain('else await withPlayerChromeHidden(persist)')
    expect(overlay).toContain('playerScreenshot(true)')
    expect(rust).toContain('capture_player_surface,')
  })

  it('records protected GIFs from a native compositor loop', () => {
    expect(drm).toContain('concealCaptureChrome')
    expect(drm).toContain('if (!fast) await concealCaptureChrome()')
    expect(drm).toContain('cropX')
    expect(drm).toContain("invoke('drm_gif_start'")
    expect(drm).not.toContain('recordGifFrames')
    expect(drm).toContain("invoke<unknown>('capture_webview_jpeg'")
    expect(overlay).toContain('playerGifStart($gifIncludeSubtitles, true)')
    expect(rust).toContain('grab(&mut jobs, first).await')
    expect(rust).toContain('capture_webview_cdp(&webview, params.into()).await')
    expect(overlay).not.toContain('Stop GIF')
    expect(drm).not.toContain('Math.max(20, remaining)')
    expect(native).toContain('player_capture_segment')
    expect(native).not.toContain('fps: plan.fps')
  })

  it('restores chrome once capture stops and encodes in the background', () => {
    const stop = drm.slice(drm.indexOf('async function gifStop'))
    const nativeStop = rust.slice(rust.indexOf('async fn drm_gif_stop'), rust.indexOf('/// Encode a bounded segment'))
    expect(stop.indexOf("invoke('drm_gif_stop')")).toBeGreaterThan(-1)
    expect(stop.indexOf("invoke('drm_gif_stop')")).toBeLessThan(stop.indexOf('finishGifUi()'))
    expect(rust).toContain('if jobs.len() >= 2')
    expect(rust).toContain('jobs.abort_all()')
    expect(nativeStop.indexOf('tauri::async_runtime::spawn(async move')).toBeLessThan(nativeStop.indexOf('join.await'))
    expect(rust).toContain('tauri::async_runtime::spawn(async move')
    expect(rust).toContain('player-gif-save-complete')
    expect(drm).toContain("listenSafe<{ ok: boolean; error?: string }>('player-gif-save-complete'")
    expect(overlay).toContain('izumi-player-root')
  })
})
