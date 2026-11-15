import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const spinner = read('./Spinner.svelte')

// Starting playback on the Deck showed a small ring, a big one and a smaller one in a row, stepping 24
// times a second. Every loading screen on the way now mounts the same `player` ring: the reference
// handheld app's faint track with a quarter arc, turning smoothly.
describe('playback ring', () => {
  it('is 84 px with a 4.5 px faint track and a quarter arc in the accent colour', () => {
    expect(spinner).toContain('const RING_PX = 84')
    expect(spinner).toContain('const RING_STROKE_PX = 4.5')
    expect(spinner).toContain('style:border="{RING_STROKE_PX / zoom}px solid rgb(255 255 255 / 0.15)"')
    expect(spinner).toContain('style:border-top-color={ringColor}')
  })

  it('keeps its screen size across page zoom and names its colour as CSS', () => {
    // A screen pixel is a CSS pixel at the player's 1:1 page zoom.
    expect(spinner).toContain('const ringPx = $derived(size === \'player\' ? RING_PX / zoom : 0)')
    // Named as CSS, so no mount forces a style pass to read it.
    expect(spinner).toContain("$themePresentation?.player?.seekbarColor ? 'var(--theme-seekbar-color)' : 'hsl(var(--primary))'")
    expect(spinner).not.toContain('getComputedStyle')
  })

  it('turns smoothly once a second on the wall-clock phase, so no screen swap restarts it', () => {
    expect(spinner).not.toContain('steps(24)')
    expect(spinner).toContain('const turnDelay = `${-(Date.now() % 1000)}ms`')
    expect(spinner).toContain('animate-spin rounded-full will-change-transform')
    // getAnimations() forces a whole-page style pass on every mount.
    expect(spinner).not.toContain('getAnimations')
  })
})
