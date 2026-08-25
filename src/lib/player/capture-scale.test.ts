import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// CDP clip/scale mutates the live window. Screenshots and GIFs capture the main
// compositor in Rust while an input-transparent window keeps controls visible.

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
    expect(rust).toContain('capture_webview_screencast_frame(&app, crop, width).await')
    expect(rust).toContain('crop_compositor_frame')
    expect(rust).toContain('async fn capture_webview_jpeg(')
    expect(rust).toContain('Do not pass a CDP `clip`')
  })

  it('captures protected playback without trying a decoded video frame first', () => {
    expect(drm).not.toContain('encodeVideoFrame')
    expect(drm).toContain('async function screenshot(_fast = false)')
    expect(drm).toContain('const presentation = await beginCapturePresentation(true)')
    expect(drm).toContain('if (screenshotTask) return screenshotTask')
    expect(drm).toContain('if (screenshotTask) await screenshotTask.catch(() => {})')
    expect(drm).toContain('await presentation.end()')
    expect(overlay).toContain('playerScreenshot(true)')
    expect(overlay).not.toContain("playerNotice.set('Saving screenshot…')")
    expect(overlay).toContain("playerNotice.set('Screenshot saved to Pictures/izumi')")
    expect(rust).toContain('capture_player_surface,')
    expect(rust).toContain('capture_webview_screencast_frame(&app, crop, width).await')
  })

  it('records protected GIFs from a native compositor loop', () => {
    expect(drm).toContain('gifPresentation = await beginCapturePresentation(true)')
    expect(drm).toContain('await finishGifUi()')
    expect(drm).toContain('cropX')
    expect(drm).toContain("invoke('drm_gif_start'")
    expect(drm).not.toContain('recordGifFrames')
    expect(drm).toContain("invoke<unknown>('capture_webview_jpeg'")
    expect(overlay).toContain('playerGifStart($gifIncludeSubtitles, true)')
    expect(rust).toContain('Page.startScreencast')
    expect(rust).toContain('"maxFramesInFlight":4')
    expect(rust).toContain('"sendLastFrame":true')
    expect(rust).toContain('gif_capture::inspect_compositor_jpeg')
    expect(rust).toContain('frames.crop')
    expect(rust).toContain('crop={crop_width}:{crop_height}:{x}:{y}')
    expect(rust).toContain('const MAX_CAPTURE_REQUESTS: usize = 4')
    expect(rust).toContain('while jobs.len() < MAX_CAPTURE_REQUESTS')
    expect(rust).toContain('capture_webview_cdp(&webview, params.into()).await')
    expect(rust).toContain('"optimizeForSpeed":true')
    // Recording state belongs to the separate controls mirror. The main compositor hides every
    // player-root child while frames are sampled, so this stop affordance cannot enter the GIF.
    expect(overlay).toContain('data-gif-recording-indicator')
    expect(overlay).toContain('controls-only mirror')
    expect(drm).not.toContain('Math.max(20, remaining)')
    expect(native).toContain('player_capture_segment')
    expect(native).not.toContain('fps: plan.fps')
  })

  it('restores chrome once capture stops and encodes in the background', () => {
    const stop = drm.slice(drm.indexOf('async function gifStop'))
    const nativeStop = rust.slice(rust.indexOf('async fn drm_gif_stop'), rust.indexOf('/// Encode a bounded segment'))
    expect(stop.indexOf("invoke('drm_gif_stop')")).toBeGreaterThan(-1)
    expect(stop.indexOf("invoke('drm_gif_stop')")).toBeLessThan(stop.indexOf('finishGifUi()'))
    expect(rust).toContain('jobs.join_next().await')
    // Finish in-flight samples while chrome is still excluded, then detach only encoding.
    expect(nativeStop.indexOf('join.await')).toBeLessThan(nativeStop.indexOf('tauri::async_runtime::spawn(async move'))
    expect(rust).toContain('tauri::async_runtime::spawn(async move')
    expect(rust).toContain('player-gif-save-complete')
    expect(drm).toContain("listenSafe<{ ok: boolean; error?: string }>('player-gif-save-complete'")
    expect(overlay).toContain('izumi-player-root')
  })
})
