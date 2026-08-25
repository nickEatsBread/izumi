import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const presentation = readFileSync('src/lib/player/capture-presentation.ts', 'utf8')
const surface = readFileSync('src/lib/components/player/DrmSurface.svelte', 'utf8')
const overlay = readFileSync('src/routes/capture-overlay/+page.svelte', 'utf8')
const css = readFileSync('src/app.css', 'utf8')
const rust = readFileSync('src-tauri/src/lib.rs', 'utf8')

describe('protected capture presentation', () => {
  it('keeps the protected video out of the controls-only mirror', () => {
    expect(presentation).toContain("clone.querySelector('.izumi-capture-root')?.remove()")
    expect(presentation).toContain("clone.querySelectorAll('video, audio, iframe, script')")
    expect(overlay).toContain('pointer-events: none')
  })

  it('keeps the real controls interactive while only their pixels leave the captured WebView', () => {
    expect(css).toContain('html.izumi-capture-output .izumi-player-root > :not(.izumi-capture-root)')
    expect(css).toContain('opacity: 0 !important')
    expect(rust).toContain('.set_ignore_cursor_events(true)')
    expect(rust).toContain('WDA_EXCLUDEFROMCAPTURE')
  })

  it('reuses the main WebView2 environment and handshakes without a missed ready event', () => {
    expect(rust).toContain('.additional_browser_args(DESKTOP_WEBVIEW_ARGS)')
    expect(rust).toContain('.content_protected(true)')
    expect(rust).toContain('WebviewUrl::default()')
    expect(presentation).toContain("invoke('capture_controls_overlay_prepare')")
    expect(presentation).toContain('PROBE_EVENT')
    expect(overlay).toContain('captureControlsEvents.probe')
  })

  it('uses the clean presentation for both screenshots and the full GIF sampling lifetime', () => {
    expect(surface).toContain('const presentation = await beginCapturePresentation(false)')
    expect(surface).toContain('gifPresentation = await beginCapturePresentation(true)')
    expect(surface).toContain('await presentation.end()')
    expect(rust).toContain('the final sampled frame obeys the video-only capture contract')
  })

  it('does not start normal app background services in the mirror WebView', () => {
    const layout = readFileSync('src/routes/+layout.svelte', 'utf8')
    expect(layout).toContain("getCurrentWindow().label === 'capture-controls'")
    expect(layout).toContain('if (captureControlsWindow) return')
  })
})
