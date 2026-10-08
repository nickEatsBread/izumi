import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const hero = readFileSync(new URL('./Hero.svelte', import.meta.url), 'utf8')

describe('hero title extras', () => {
  it('loads the extras the hero template binds, current slide first', () => {
    expect(hero).toContain('const heroNeeds = $derived(templateNeeds(heroTheme?.template))')
    expect(hero).toContain('primeTitleExtras(fresh, needs)')
    expect(hero).toContain('keyart: currentExtras?.keyart, ageRating: currentExtras?.ageRating, audio: currentExtras?.audio,')
    expect(hero).toContain('logo: currentLogo || currentExtras?.logo || undefined,')
  })
  it('loads the artwork apart from the slower rating and audio lookups', () => {
    expect(hero).toContain('const art = artNeeds(needs)')
    expect(hero).toContain('const meta = metaNeeds(needs)')
    expect(hero).toContain('loadTitleExtras(media, art)')
    expect(hero).toContain('loadTitleExtras(media, meta)')
  })
  it('asks once per slide and extras set, whatever the catalog re-emits', () => {
    // Home builds a new slide array on every catalog emission: the effect keys on the ids.
    expect(hero).toContain("const heroIds = $derived(medias.map((media) => media.id).join(','))")
    expect(hero).toContain("const heroNeedsKey = $derived([...heroNeeds].sort().join(','))")
    expect(hero).toContain('const list = untrack(() => medias)')
    // A plain Set, not $state: the effect reads and writes it.
    expect(hero).toContain('const requestedExtras = new Set<string>()')
    // Keyed by the extras bound too, so a theme that binds more loads them again.
    expect(hero).toContain('const extrasKey = (id: number) => `${heroNeedsKey}|${id}`')
    // No teardown flag drops results that are still wanted.
    expect(hero).not.toContain('if (!cancelled) extras = ')
  })
  it('holds the slide back briefly while its key art or logo loads', () => {
    expect(hero).toContain('data-pending={extrasPending || undefined}')
    expect(hero).toContain('.theme-custom-hero[data-pending] :global(.theme-template) { visibility: hidden; }')
    expect(hero).toContain('setTimeout(() => (extrasWaitOver = true), 1500)')
    // Only the artwork decides the wait; a rating or audio still loading does not.
    // API 4 `hero.art: "banner-cover"` adds the key art a backdrop without a banner waits for.
    expect(hero).toContain('const extrasPending = $derived(((heroArtNeeded && !!current && !currentArt) || backdropPending) && !extrasWaitOver)')
  })
  it('decodes a slide\'s key art and logo before stepping to it', () => {
    expect(hero).toContain('const art = heroArt[extrasKey(m.id)]')
    // `banner(m)` unless the theme asks for `hero.art: "banner-cover"` (hero-art.ts).
    expect(hero).toContain('return [templateBackdrop(m) ?? banner(m), cover(m), ...[art?.keyart, art?.logo, art?.posterHd].filter((src): src is string => !!src)]')
    expect(hero).toContain("const templateBackdrop = (m: Media) => (heroTheme?.art === 'banner-cover' ? heroBackdrop(m, keyartOf(m), 'banner-cover') : undefined)")
  })
  it('sizes a wide hero as the 16:9 artwork and runs its bottom under the rows', () => {
    expect(hero).toContain("const wideScale = $derived(!$isMobile && heroTheme?.scale === 'wide')")
    // Only the wide scale adds the bleed to its height; other scales would clip the lifted content.
    expect(hero).toContain('const heroBleed = $derived(wideScale && heroTheme?.template ? heroTheme.bleed ?? 0 : 0)')
    expect(hero).toContain('class:theme-wide-scale={wideScale}')
    expect(hero).toContain('class:theme-hero-bleed={heroBleed > 0}')
    expect(hero).toContain('style:--hero-bleed={heroBleed > 0 ? `${heroBleed}px` : undefined}')
    expect(hero).toContain('aspect-ratio: 16 / 9;')
    // Zero specificity, so a following sibling that positions itself (sticky, absolute) keeps it.
    expect(hero).toContain(':global(:where(.theme-hero-bleed ~ *)) { position: relative; }')
    expect(hero).toContain('margin-bottom: calc(1.5rem - var(--hero-bleed));')
    // The lift pads the template's top overlay only, not overlays nested inside it.
    expect(hero).toContain('.theme-hero-bleed :global(.theme-template > .theme-overlay > :not(img):not(.theme-artwork)) { padding-bottom: calc(1.75rem + var(--hero-bleed)); }')
  })
  it('gives slide markers a track, a fill and a past state', () => {
    expect(hero).toContain('data-part="hero.dot.track"')
    expect(hero.match(/data-part="hero\.dot\.fill"/g)?.length).toBe(2)
    expect(hero).toContain('data-past={idx < i || undefined}')
    expect(hero).toContain("idx < i && indicator.past !== 'empty' ? 1 : 0")
  })
})
