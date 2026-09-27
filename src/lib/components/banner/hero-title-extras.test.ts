import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const hero = readFileSync(new URL('./Hero.svelte', import.meta.url), 'utf8')

describe('hero title extras', () => {
  it('loads the extras the hero template binds, current slide first', () => {
    expect(hero).toContain('const heroNeeds = $derived(templateNeeds(heroTheme?.template))')
    expect(hero).toContain('primeTitleExtras(list, needs)')
    expect(hero).toContain('loadTitleExtras(media, needs)')
    expect(hero).toContain('keyart: currentExtras?.keyart, ageRating: currentExtras?.ageRating, audio: currentExtras?.audio,')
    expect(hero).toContain('logo: currentLogo || currentExtras?.logo || undefined,')
  })
  it('holds the slide back briefly while its key art or logo loads', () => {
    expect(hero).toContain('data-pending={extrasPending || undefined}')
    expect(hero).toContain('.theme-custom-hero[data-pending] :global(.theme-template) { visibility: hidden; }')
    expect(hero).toContain('setTimeout(() => (extrasWaitOver = true), 1500)')
  })
  it('sizes a wide hero as the 16:9 artwork and runs its bottom under the rows', () => {
    expect(hero).toContain("const wideScale = $derived(!$isMobile && heroTheme?.scale === 'wide')")
    expect(hero).toContain('class:theme-wide-scale={wideScale}')
    expect(hero).toContain('class:theme-hero-bleed={heroBleed > 0}')
    expect(hero).toContain('style:--hero-bleed={heroBleed > 0 ? `${heroBleed}px` : undefined}')
    expect(hero).toContain('aspect-ratio: 16 / 9;')
    expect(hero).toContain('.theme-hero-bleed ~ :global(*) { position: relative; }')
    expect(hero).toContain('margin-bottom: calc(1.5rem - var(--hero-bleed));')
  })
  it('gives slide markers a track, a fill and a past state', () => {
    expect(hero).toContain('data-part="hero.dot.track"')
    expect(hero.match(/data-part="hero\.dot\.fill"/g)?.length).toBe(2)
    expect(hero).toContain('data-past={idx < i || undefined}')
    expect(hero).toContain("idx < i && indicator.past !== 'empty' ? 1 : 0")
  })
})
