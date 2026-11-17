import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const spinner = read('./Spinner.svelte')
const osd = read('../../../src-tauri/src/player/gm_osd.rs')
const css = read('../../app.css')
const bridge = read('../player/theme-gm-osd.ts')

// Starting playback on the Deck showed a small ring, a big one and a smaller one in a row, stepping 24
// times a second; the last is mpv's own, drawn by gm_osd.rs. The page's `player` ring stands in for it
// until mpv's window covers the page, so any difference between the two shows at that hand-off. Both
// are now a faint track with a quarter arc, turning smoothly.
describe('playback ring', () => {
  it('draws the same ring as mpv: a faint track and a quarter arc in the accent colour', () => {
    const overlay = osd.slice(osd.indexOf('fn loading_overlay('), osd.indexOf('fn arc_band('))
    expect(overlay).toContain('let outer = size / 2.0 * unit;')
    expect(overlay).toContain('let inner = (size / 2.0 - stroke) * unit;')
    expect(overlay).toContain('circle_ring(cx, cy, inner, outer, "FFFFFF", &alpha_hex(0.15))')
    expect(overlay).toContain('centre - PI / 4.0, centre + PI / 4.0')
    expect(spinner).toContain('style:border="calc(var(--theme-player-spinner-stroke) / {zoom}) solid rgb(255 255 255 / 0.15)"')
    expect(spinner).toContain('style:border-top-color={ringColor}')
  })

  it("is the player's usual 48 px ring unless a theme sizes it, and mpv's follows the page's", () => {
    // v0.1.75 made every client's ring the Crunchy Deck theme's 84 px one.
    expect(css).toContain('html { --theme-player-spinner-size: 48px; --theme-player-spinner-stroke: 4px; }')
    expect(osd).toMatch(/\{ size\.clamp\(16\.0, 256\.0\) \} else \{ 48\.0 \}/)
    expect(osd).toMatch(/\{ stroke\.clamp\(1\.0, size \/ 2\.0\) \} else \{ 4\.0 \}/)
    // A screen pixel is a CSS pixel at the player's 1:1 page zoom.
    expect(spinner).toContain('style:width="calc(var(--theme-player-spinner-size) / {zoom})"')
    expect(spinner).toContain('style:height="calc(var(--theme-player-spinner-size) / {zoom})"')
    // The theme's size reaches mpv with its colours.
    expect(bridge).toContain("probe.style.width = 'var(--theme-player-spinner-size)'")
    expect(bridge).toContain("probe.style.height = 'var(--theme-player-spinner-stroke)'")
    expect(osd).toContain('spinner_ring(state.theme_spinner_size, state.theme_spinner_stroke)')
  })

  it('is in the colour mpv draws it in', () => {
    // mpv's choice (readGmOsdTheme) named as CSS, so no mount forces a style pass to read it.
    expect(spinner).toContain("$themePresentation?.player?.seekbarColor ? 'var(--theme-seekbar-color)' : 'hsl(var(--primary))'")
    expect(spinner).not.toContain('getComputedStyle')
    expect(osd).toContain('loading_overlay(phase, w, h, unit, ring, theme_color(&state.theme_accent), &mut lines);')
  })

  it('turns smoothly once a second on the same wall-clock phase as mpv', () => {
    expect(spinner).not.toContain('steps(24)')
    expect(spinner).toContain('const turnDelay = `${-(Date.now() % 1000)}ms`')
    expect(spinner).toContain('animate-spin rounded-full will-change-transform')
    // getAnimations() forced a whole-page style pass on WebKitGTK (0.4 s a mount on the Deck).
    expect(spinner).not.toContain('getAnimations')
    const phase = osd.slice(osd.indexOf('fn spinner_phase()'))
    expect(phase.slice(0, phase.indexOf('\n}'))).toContain('ms as f64 / 1000.0')
    expect(osd).toContain('spinner_phase(),')
  })
})
