import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const css = read('../../app.css')
const lib = read('../../../src-tauri/src/lib.rs')

// Deck (gamescope) touch:
//  - tao's borderless-window resize hit-test starts an X11 resize drag for any press/touch within
//    5 px of the window edge (= the screen edge under gamescope); gamescope then upscales the
//    shrunken window, which reads as "the UI zoomed in" and drags lag while the finger moves.
//  - Rows are native scrollers in Game mode: Chromium scrolls and flings them, and a vertical swipe
//    that starts on a row still moves the page. No script drives a row from touch.
//  - Desktop Chromium ignores the viewport `user-scalable=no` meta, so `touch-action` keeps pinch-zoom out.

describe('Deck edge-touch resize', () => {
  it('makes the main window non-resizable under gamescope so tao never starts an edge resize drag', () => {
    const builder = lib.slice(lib.indexOf('.inner_size(1280.0, 800.0)'), lib.indexOf('.background_color(tauri::window::Color(10, 10, 11, 255))'))
    expect(builder).toContain('.resizable(!gamescope)')
  })
})

describe('Game-mode carousel rows and native touch scrolling', () => {
  it('leaves Game-mode rows native: no overflow pin, and the desktop pin skips Game mode', () => {
    expect(css).not.toMatch(/\.gamemode \[data-carousel-scroller\] \{[^}]*overflow/)
    const desktop = css.slice(css.indexOf('@media (hover: hover) and (pointer: fine) {'))
    expect(desktop).toContain('html:not(.gamemode) [data-carousel-scroller] { overflow: hidden; touch-action: pan-y; }')
  })
})

describe('Game-mode pinch zoom', () => {
  it('keeps pinch-zoom out of the page with touch-action, not script', () => {
    expect(css).toContain('.gamemode { touch-action: pan-x pan-y; }')
  })
})
