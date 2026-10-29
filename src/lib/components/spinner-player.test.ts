import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const spinner = read('./Spinner.svelte')
const osd = read('../../../src-tauri/src/player/gm_osd.rs')

// Starting playback on the Deck showed four loaders in a row; the last is mpv's own, drawn by
// gm_osd.rs. The page's `player` ring stands in for it until mpv's window covers the page, so any
// difference between the two shows at that hand-off.
describe('playback ring', () => {
  it('draws mpv\'s ring: 24 segments from radius 24 to 31, fading by its alphas', () => {
    const overlay = osd.slice(osd.indexOf('fn loading_overlay('), osd.indexOf('fn push('))
    expect(overlay).toContain('let segments = 24usize;')
    expect(overlay).toContain('ring_segment(cx, cy, 24.0, 31.0,')
    expect(spinner).toContain('<line x1="0" y1="-24" x2="0" y2="-31"')
    expect(spinner).toContain('transform="rotate({i * 15})"')
    const alphas = [...overlay.slice(overlay.indexOf('let alphas')).matchAll(/"([0-9A-F]{2})"/g)].map((m) => 1 - parseInt(m[1], 16) / 255)
    const opacities = JSON.parse(/\[(1, 0\.95[^\]]*)\]/.exec(spinner)![0]) as number[]
    expect(opacities).toHaveLength(alphas.length)
    opacities.forEach((opacity, i) => expect(opacity).toBeCloseTo(alphas[i], 1))
  })

  it('is the size mpv draws it at, in the colour mpv draws it in', () => {
    // A viewBox unit is an ASS pixel, which is a CSS pixel at the player's 1:1 page zoom.
    expect(spinner).toContain('viewBox="-32 -32 64 64"')
    expect(spinner).toContain('64 / ($gameMode ? deckWebviewZoom($uiScale, $playing) : 1)')
    // mpv's choice (readGmOsdTheme) named as CSS, so no mount forces a style pass to read it.
    expect(spinner).toContain("$themePresentation?.player?.seekbarColor ? 'var(--theme-seekbar-color)' : 'hsl(var(--primary))'")
    expect(spinner).not.toContain('getComputedStyle')
    expect(osd).toContain('loading_overlay(phase, w, h, theme_color(&state.theme_accent), &mut lines);')
  })

  it('turns 24 steps a second on the same wall-clock phase as mpv', () => {
    expect(spinner).toContain('style:animation-timing-function="steps(24)"')
    expect(spinner).toContain('const turnDelay = `${-((Date.now() + 1000 / 48) % 1000)}ms`')
    // getAnimations() forced a whole-page style pass on WebKitGTK (0.4 s a mount on the Deck).
    expect(spinner).not.toContain('getAnimations')
    const phase = osd.slice(osd.indexOf('fn spinner_phase()'))
    expect(phase.slice(0, phase.indexOf('\n}'))).toContain('SystemTime::now()')
    expect(osd).toContain('spinner_phase(),')
  })
})
