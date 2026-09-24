import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const hero = readFileSync(fileURLToPath(new URL('./Hero.svelte', import.meta.url)), 'utf8')

// Deck (Gamescope) featured-banner flicker. Two halves, both must stay:
//  1. the slide swap waits for decoded artwork, so the first paint of a slide is never a skeleton;
//  2. Game mode drops the entrance tweens, so no soft compositor layer snaps crisp mid-step.
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

  it('drops the hero entrance tweens under html.gamemode without changing the resting look', () => {
    expect(hero).toMatch(/:global\(html\.gamemode\) \.hero-slide-in,\s*:global\(html\.gamemode\) \.detail-hero-reveal,\s*:global\(html\.gamemode\) \.hero-copy \{ animation: none; \}/)
    expect(hero).toMatch(/:global\(html\.gamemode\) \.hero-artwork,\s*:global\(html\.gamemode\) \.hero-root \{ transition: none; \}/)
    // Without the animation's fill the artwork would jump to full opacity: the rest state is static.
    expect(hero).toContain('.hero-slide-in { opacity: var(--hero-final-opacity, 1); animation: hero-slide-in')
    expect(hero).toContain('.detail-hero-reveal { opacity: var(--hero-final-opacity, .7); animation: detail-hero-reveal')
    expect(hero.match(/class="hero-artwork /g)?.length).toBe(3)
    expect(hero).toContain('class="hero-root relative mb-6')
  })

  it('steps the rotation progress bar in Game mode instead of compositing every frame', () => {
    const rule = hero.match(/:global\(html\.gamemode\) \.hero-progress \{[^}]*\}/)
    expect(rule, 'gamemode rule for .hero-progress').toBeTruthy()
    expect(rule![0]).toContain('animation-name: hero-progress-steps')
    expect(rule![0]).toMatch(/animation-timing-function:\s*steps\(24, end\)/)
    expect(rule![0]).toContain('transform: none')
    expect(hero).toMatch(/@keyframes hero-progress-steps \{\s*from \{ width: 0; \}\s*to \{ width: 100%; \}\s*\}/)
  })
})
