import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const actions = read('./actions.ts')
const css = read('../../app.css')
const layout = read('../../routes/app/+layout.svelte')
const lib = read('../../../src-tauri/src/lib.rs')

// Three Deck (gamescope) touch regressions, all traced to code outside the app:
//  - tao's borderless-window resize hit-test starts an X11 resize drag for any press/touch within
//    5 px of the window edge (= the screen edge under gamescope); gamescope then upscales the
//    shrunken window, which reads as "the UI zoomed in" and drags lag while the finger moves.
//  - WebKitGTK turns a finger drag into synthesized wheel events carrying BOTH axes, hit-tested at
//    the drag's start point and with no `touch-action` handling; an overflow-x row accepts any
//    sample with a non-zero dx and silently drops its dy, so a vertical swipe that starts on a
//    row barely scrolls the page.
//  - WebKitGTK's pinch gesture ignores the viewport `user-scalable=no` meta entirely.

describe('Deck edge-touch resize', () => {
  it('makes the main window non-resizable under gamescope so tao never starts an edge resize drag', () => {
    const builder = lib.slice(lib.indexOf('.inner_size(1280.0, 800.0)'), lib.indexOf('.background_color(tauri::window::Color(10, 10, 11, 255))'))
    expect(builder).toContain('.resizable(!gamescope)')
  })
})

describe('Game-mode carousel rows and native touch scrolling', () => {
  it('takes rows out of the native wheel/drag target chain so a vertical swipe on a row scrolls the page', () => {
    const rule = css.slice(css.indexOf('.gamemode [data-carousel-scroller]'))
    expect(rule.slice(0, rule.indexOf('}'))).toMatch(/overflow:\s*hidden/)
  })

  it('grabs the touch sequence (non-passive touchmove preventDefault) once a row drag is horizontal', () => {
    const fn = actions.slice(actions.indexOf('export function gameModeCarouselTouch'), actions.indexOf('export function suppressNativeTooltips'))
    expect(fn).toContain("node.addEventListener('touchmove', onTouchMove, { passive: false })")
    const handler = fn.slice(fn.indexOf('const onTouchMove'), fn.indexOf('const onEnd'))
    expect(handler).toContain("if (axis === 'horizontal') event.preventDefault()")
    expect(fn).toContain("node.removeEventListener('touchmove', onTouchMove)")
  })
})

describe('Game-mode pinch zoom', () => {
  it('denies the second finger to WebKitGTK before its zoom gesture can begin', () => {
    expect(actions).toContain('export function suppressPinchZoom')
    const fn = actions.slice(actions.indexOf('export function suppressPinchZoom'))
    expect(fn).toContain("if (e.touches.length > 1) e.preventDefault()")
    expect(fn).toMatch(/addEventListener\('touchstart', [^,]+, \{ passive: false, capture: true \}\)/)
    expect(layout).toContain('suppressPinchZoom()')
  })
})
