import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The discussanime archive pins its cross-origin iframe ROOT to `color-scheme: normal`, while
// izumi's embedder side is `color-scheme: dark` (app.css) — mismatched schemes make Chromium
// paint the frame on an OPAQUE WHITE canvas behind the archive's transparent surface, so the
// whole embed reads as light no matter how dark its tokens are. The cure is running
// DARK_FRAME_SCRIPT inside the frame (sets `data-theme="dark"` on the archive's <html>, root
// goes dark, canvas turns transparent). Windows injects it natively; Android must register it
// as a plugin init script (wry hands those to addDocumentStartJavaScript with origin rule "*",
// which reaches cross-origin subframes). None of that is exercisable here (no webview), so the
// wiring is pinned at the source level.
const lib = readFileSync(
  fileURLToPath(new URL('../../../src-tauri/src/lib.rs', import.meta.url)),
  'utf8',
)

describe('archive embed dark canvas on Android', () => {
  it('compiles the dark-frame script for Android, not just Windows', () => {
    expect(lib).toMatch(/#\[cfg\(any\(windows, target_os = "android"\)\)\]\r?\nconst DARK_FRAME_SCRIPT/)
  })

  it('registers the script as an Android plugin init script', () => {
    expect(lib).toMatch(
      /#\[cfg\(target_os = "android"\)\][\s\S]{0,400}?\.js_init_script\(DARK_FRAME_SCRIPT\.to_string\(\)\)/,
    )
  })

  it('keeps the script self-gated to the archive embed frame and self-healing', () => {
    expect(lib).toContain("location.pathname.indexOf('/embed/discussion')!==0)return")
    expect(lib).toContain('new MutationObserver(set)')
  })
})
