// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { captureControlsFrame } from './capture-presentation'

const presentation = readFileSync('src/lib/player/capture-presentation.ts', 'utf8')
const surface = readFileSync('src/lib/components/player/DrmSurface.svelte', 'utf8')
const overlay = readFileSync('src/routes/capture-overlay/+page.svelte', 'utf8')
const comments = readFileSync('src/lib/components/player/CommentsPanel.svelte', 'utf8')
const titlebar = readFileSync('src/lib/components/shell/Titlebar.svelte', 'utf8')
const css = readFileSync('src/app.css', 'utf8')
const rust = readFileSync('src-tauri/src/lib.rs', 'utf8')

describe('protected capture presentation', () => {
  it('keeps the protected video out of the controls-only mirror', () => {
    expect(presentation).toContain("clone.querySelector('.izumi-capture-root')?.remove()")
    expect(presentation).toContain("clone.querySelectorAll('video, audio, iframe, script')")
    expect(overlay).toContain('pointer-events: none')
  })

  it('does not resurrect the inert cached discussion panel in the controls mirror', () => {
    expect(comments).toContain('data-capture-exclude-when-inert')
    expect(presentation).toContain("'[data-capture-exclude-when-inert][inert]'")
    document.body.innerHTML = `
      <div class="izumi-player-root">
        <button>Play</button>
        <div data-comments-panel data-capture-exclude-when-inert inert>Discussion cache</div>
      </div>`
    const frame = captureControlsFrame(1)
    expect(frame.html).toContain('Play')
    expect(frame.html).not.toContain('Discussion cache')
    document.querySelector('[data-comments-panel]')?.removeAttribute('inert')
    expect(captureControlsFrame(2).html).toContain('Discussion cache')
    document.body.replaceChildren()
  })

  it('does not mirror capture-excluded titlebar chrome across the player seam', () => {
    expect(titlebar).toContain('data-capture-exclude')
    document.body.innerHTML = `
      <div data-tauri-drag-region>
        <button data-capture-exclude>GIF</button>
        <button>Close</button>
      </div>`
    const frame = captureControlsFrame(3)
    expect(frame.html).not.toContain('>GIF<')
    expect(frame.html).toContain('>Close<')
    document.body.replaceChildren()
  })

  it('does not recreate a focus outline on the clipped player root', () => {
    document.body.innerHTML = `
      <div class="izumi-player-root" tabindex="-1">
        <button>Pause</button>
      </div>`
    const root = document.querySelector<HTMLElement>('.izumi-player-root')!
    root.focus()
    const frame = captureControlsFrame(4)
    expect(frame.html).not.toContain('data-capture-focus')
    expect(overlay).toContain('[data-capture-focus]:not(.izumi-player-root)')
    document.body.replaceChildren()
  })

  it('keeps the real controls interactive while only their pixels leave the captured WebView', () => {
    expect(css).toContain('html.izumi-capture-output .izumi-player-root > :not(.izumi-capture-root)')
    expect(css).toContain('opacity: 0 !important')
    expect(rust).toContain('.set_ignore_cursor_events(true)')
    expect(rust).not.toContain('WDA_EXCLUDEFROMCAPTURE')
    expect(rust).not.toContain('.content_protected(true)')
  })

  it('reuses the main WebView2 environment and handshakes without a missed ready event', () => {
    expect(rust).toContain('.additional_browser_args(DESKTOP_WEBVIEW_ARGS)')
    expect(rust).toContain('WebviewUrl::default()')
    expect(presentation).toContain("invoke('capture_controls_overlay_prepare')")
    expect(presentation).toContain('PROBE_EVENT')
    expect(overlay).toContain('captureControlsEvents.probe')
  })

  it('matches the main client area without disappearing from Windows screen captures', () => {
    expect(rust).toContain('main.inner_position()')
    expect(rust).toContain('main.inner_size()')
    expect(rust).not.toContain('main.outer_position()')
    expect(rust).not.toContain('main.outer_size()')
  })

  it('does not leak the controls mirror over unrelated foreground applications', () => {
    const builder = rust.slice(
      rust.indexOf('.title("izumi capture controls")'),
      rust.indexOf('Err(error) => eprintln!("[capture-controls] create failed'),
    )
    expect(builder).toContain('.always_on_top(false)')
    expect(builder).not.toContain('.always_on_top(true)')
    expect(rust).toContain('.set_always_on_top(false)')
    expect(presentation).toContain('mainWindow.onFocusChanged')
    expect(presentation).toContain("focused ? 'capture_controls_overlay_present' : 'capture_controls_overlay_hide'")
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
