import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const hero = readFileSync(fileURLToPath(new URL('./Hero.svelte', import.meta.url)), 'utf8')

/** Every declaration Hero.svelte applies to `selector` under `html.gamemode`, grouped rules included. */
function gameMode(selector: string): string {
  let declarations = ''
  for (const [, selectors, body] of hero.matchAll(/((?::global\(html\.gamemode\) [^,{}]+,\s*)*:global\(html\.gamemode\) [^,{}]+?)\s*\{([^}]*)\}/g)) {
    const list = selectors.split(',').map((s) => s.trim().replace(/^:global\(html\.gamemode\) /, ''))
    if (list.includes(selector)) declarations += body
  }
  return declarations
}

/** The body of `@keyframes <name>`. */
function keyframes(name: string): string {
  const match = hero.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n  \\}`))
  expect(match, `@keyframes ${name}`).toBeTruthy()
  return match![1]
}

// Deck (Gamescope) featured-banner flicker. Two halves, both must stay:
//  1. the slide swap waits for decoded artwork, so the first paint of a slide is never a skeleton;
//  2. every Game-mode hero tween runs on a compositor layer that lives exactly as long as its
//     element. WebKitGTK 2.52 composites without waiting for tile painting, so a layer dropped when
//     a tween ends can present a frame without its content: the blink. The animations stay.
describe('Steam Deck featured banner flicker', () => {
  it('decodes the incoming artwork before committing the slide', () => {
    expect(hero).toContain("import { createSlideScheduler } from './hero-slides'")
    expect(hero).toContain('img.decode()')
    expect(hero).toContain('if (ready) loadedArtworkId = medias[n].id')
    expect(hero).toContain('slides.request(n, direction ?? (n > i ? 1 : -1), slideArtwork(medias[n]))')
    // Rapid L1/R1 presses chain from the slide already on its way.
    expect(hero).toContain('go(((slides.pending() ?? i) + direction + n) % n, direction)')
  })

  it('keeps the neighbouring slides warm so the next step is instant', () => {
    expect(hero).toContain('slides.warm([...slideArtwork(medias[(i + 1) % n]), ...slideArtwork(medias[(i - 1 + n) % n])])')
    expect(hero).toContain('const artworkSettled = () => { loadedArtworkId = current.id; scheduleWarm() }')
  })

  it('animates the Home carousel in Game mode, in both directions', () => {
    // Only the Home carousel is marked; a detail banner is a single slide and stays static.
    expect(hero).toContain('class:hero-carousel-slide={showOverlay}')
    expect(gameMode('.hero-slide-in'), 'no Game-mode rule may stop every slide').toBe('')
    expect(gameMode('.hero-carousel-slide')).toContain('animation-name: hero-slide-in-layer')
    expect(gameMode('.hero-copy')).toContain('animation-name: hero-copy-in-layer')
    expect(gameMode('.hero-copy')).not.toContain('animation: none')
    // The direction still comes from the step: L1/R1, a swipe or the auto-advance.
    expect(keyframes('hero-slide-in-layer')).toContain('translate: var(--hero-enter-x) 0')
    expect(keyframes('hero-copy-in-layer')).toContain('translate: var(--hero-enter-x) 8px')
  })

  it('pins every Game-mode hero tween to a layer that outlives the tween', () => {
    for (const [selector, name] of [
      ['.hero-carousel-slide', 'hero-slide-in-layer'],
      ['.hero-copy', 'hero-copy-in-layer'],
      ['.hero-progress', 'hero-progress-fill-layer'],
    ]) {
      // A static 3D transform keeps the element composited from creation to removal.
      expect(gameMode(selector), selector).toContain('transform: translateZ(0)')
      // The keyframes must not touch `transform`: that would override the anchor, and a
      // translate3d(x, 0, 0) → translate3d(0, 0, 0) tween blends down to a 2D translate, which drops
      // the layer as soon as the fill takes over.
      expect(keyframes(name), `${name} keyframes`).not.toMatch(/transform:/)
    }
  })

  it('keeps detail banners, the late-artwork fade and the scroll dim static in Game mode', () => {
    expect(gameMode('.hero-slide-in:not(.hero-carousel-slide)')).toContain('animation: none')
    expect(gameMode('.detail-hero-reveal')).toContain('animation: none')
    expect(gameMode('.hero-artwork')).toContain('transition: none')
    expect(gameMode('.hero-root')).toContain('transition: none')
    // Without the animation's fill the artwork would jump to full opacity: the rest state is static.
    expect(hero).toContain('.hero-slide-in { opacity: var(--hero-final-opacity, 1); animation: hero-slide-in')
    expect(hero).toContain('.detail-hero-reveal { opacity: var(--hero-final-opacity, .7); animation: detail-hero-reveal')
    expect(hero.match(/class="hero-artwork /g)?.length).toBe(3)
    expect(hero).toContain('class="hero-root relative mb-6')
  })

  it('fills the rotation progress bar continuously in Game mode', () => {
    const rule = gameMode('.hero-progress')
    expect(rule).toContain('animation-name: hero-progress-fill-layer')
    expect(rule).not.toMatch(/steps\(|animation-timing-function/)
    expect(keyframes('hero-progress-fill-layer')).toMatch(/from \{ scale: 0 1; \}\s*to \{ scale: 1 1; \}/)
    expect(hero).not.toContain('hero-progress-steps')
  })
})
