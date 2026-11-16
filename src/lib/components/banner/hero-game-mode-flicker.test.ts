import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const hero = readFileSync(fileURLToPath(new URL('./Hero.svelte', import.meta.url)), 'utf8')

// The featured banner never pops a skeleton between slides: the slide swap waits for decoded
// artwork, so the first paint of a slide is the image. Its motion is plain CSS on every engine,
// Game mode included (the Deck runs Chromium).
describe('Steam Deck featured banner flicker', () => {
  it('decodes the incoming artwork before committing the slide', () => {
    expect(hero).toContain("import { createSlideScheduler } from './hero-slides'")
    expect(hero).toContain('img.decode()')
    expect(hero).toContain('if (ready) loadedArtworkId = medias[n].id')
    expect(hero).toContain('slides.request(n, direction ?? (n > i ? 1 : -1), slideArtwork(medias[n]))')
    // Rapid L1/R1 presses chain from the slide already on its way.
    expect(hero).toContain('go(((slides.pending() ?? i) + direction + n) % n, direction, now)')
  })

  it('moves at once for a finger swipe, where waiting on the artwork only lagged', () => {
    expect(hero).toContain('if (now) { slides.cancel(); commitSlide(n, direction ?? (n > i ? 1 : -1), slides.ready(slideArtwork(medias[n]))); return }')
    expect(hero).toContain('step(dx < 0 ? 1 : -1, true)')
  })

  it('keeps the neighbouring slides warm so the next step is instant', () => {
    expect(hero).toContain('slides.warm([...slideArtwork(medias[(i + 1) % n]), ...slideArtwork(medias[(i - 1 + n) % n])])')
    expect(hero).toContain('const artworkSettled = () => { loadedArtworkId = current.id; scheduleWarm() }')
  })

  it('keeps the CSS slide, copy and progress-bar motion in Game mode, with no scripted fallback', () => {
    expect(hero).not.toContain('html.gamemode')
    expect(hero).not.toContain('gameModeOnly')
    expect(hero).not.toContain('requestAnimationFrame(paint)')
    expect(hero).toContain('.hero-slide-in { opacity: var(--hero-final-opacity, 1); animation: hero-slide-in')
    expect(hero).toContain('animation: hero-progress-fill var(--theme-hero-interval, 15s) linear forwards;')
    expect(hero).toContain('<div class="hero-fade-out" class:hero-fade-pending={!fadeFrom.shown} aria-hidden="true" inert class:running={fadeFrom.running}>')
  })
})
