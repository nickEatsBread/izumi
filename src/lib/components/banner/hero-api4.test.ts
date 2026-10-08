import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const hero = read('./Hero.svelte')
const home = read('../../../routes/app/home/+page.svelte')
const merged = read('../catalog/MergedCatalogHome.svelte')
const catalog = read('../catalog/CatalogHome.svelte')
const sheet = read('../detail/MediaListSheet.svelte')

describe("a hero template's list action", () => {
  it('calls the host for the current slide', () => {
    expect(hero).toContain('onlist?: (m: Media) => void')
    expect(hero).toContain('list: onlist ? () => themeAction(() => onlist?.(current)) : undefined,')
    expect(hero).toContain('<ThemeNode node={heroTheme.template} model={themeModel} eager titleHeading actions={templateActions} />')
  })

  it('opens the list editor over every Home that features titles', () => {
    for (const page of [home, merged, catalog]) {
      expect(page).toContain("import MediaListSheet from '$lib/components/detail/MediaListSheet.svelte'")
      expect(page).toMatch(/onlist=\{\((m|media)\) => \(listMedia = (m|media)\)\}/)
      expect(page).toContain('{#if listMedia}<MediaListSheet media={listMedia} onclose={() => (listMedia = null)} />{/if}')
    }
  })

  it("reads the title's entries before editing, and gives a title without an AniList identity the Save sheet", () => {
    expect(sheet).toContain('{#if !anilistId}\n  <LocalListPicker {media} {onclose} />')
    expect(sheet).toContain('const entry = $derived(reads ? seriesListEntry({')
    expect(sheet).toContain('{:else if entry}\n  <ListEditor')
  })
})

describe('hero slide count, pool and transition (API 4)', () => {
  it('takes the pool and the count from the theme on the AniList Home', () => {
    expect(home).toContain("const heroSource = $derived(heroTheme?.source ?? 'season')")
    expect(home).toContain('const heroLimit = $derived(heroTheme?.limit ?? 7)')
    expect(home).toContain('variables: heroVars(new Date(), source),')
    expect(home).toContain("if (heroSource === 'trending') return rankFeaturedMedia(pool, 'Trending Now').slice(0, heroLimit)")
    expect(home).toContain('.slice(0, heroLimit)\n  })')
  })

  it('caps the other catalogs at the same count', () => {
    expect(merged).toContain('.slice(0, $themePresentation?.hero?.limit ?? 10)')
    expect(catalog).toContain('const heroSlides = $derived($themePresentation?.hero?.limit ? (home?.hero ?? []).slice(0, $themePresentation.hero.limit) : home?.hero ?? [])')
    expect(catalog).toContain('<Hero medias={heroSlides}')
  })

  it('cross-fades only with motion allowed, from the slide on screen', () => {
    expect(hero).toContain("const fadeTransition = $derived(showOverlay && heroTheme?.transition === 'fade')")
    expect(hero).toContain('if (fadeTransition && n !== i && medias[i] && motionAllowed()) startFade()')
    expect(hero).toContain("return motion !== 'reduce' && (motion === 'full' || !matchMedia('(prefers-reduced-motion: reduce)').matches)")
    expect(hero).toContain('const FADE_MS = 650')
    // The outgoing template copy is inert and hidden from assistive technology, and renders the same
    // markup as the live slide (its title an h1), so heading styles do not change as it starts fading.
    expect(hero).toContain('<div class="hero-fade-out" aria-hidden="true" inert><ThemeNode node={heroTheme.template} model={fadeFrom.model} eager titleHeading actions={fadeActions} /></div>')
    expect(hero).toContain('<div data-part="hero.slide" data-state="leaving" aria-hidden="true" class="absolute inset-0">')
  })

  // The WebKitGTK 2.52 layer-drop blink (hero-game-mode-flicker.test.ts): a layer that animates must
  // hold a static translateZ(0) for its whole life, so the fade animates opacity alone.
  it('animates opacity alone and keeps the static layer anchor in Game mode', () => {
    const keyframes = (name: string) => hero.slice(hero.indexOf(`@keyframes ${name} {`), hero.indexOf('}\n  }', hero.indexOf(`@keyframes ${name} {`)) + 4)
    for (const name of ['hero-fade-in', 'hero-fade-out']) {
      const block = keyframes(name)
      expect(block, name).toContain('opacity')
      expect(block, name).not.toMatch(/transform|translate|scale/)
    }
    expect(hero).toContain('.hero-fade-out { position: absolute; inset: 0; z-index: 1; pointer-events: none; transform: translateZ(0); animation: hero-fade-out 650ms ease both; }')
    expect(hero).toContain(':global(html.gamemode) .hero-carousel-slide,\n  :global(html.gamemode) .hero-copy,\n  :global(html.gamemode) .hero-progress { transform: translateZ(0); }')
    expect(hero).toContain(':global(html.gamemode) .hero-fade .hero-carousel-slide,\n  :global(html.gamemode) .hero-fade .hero-copy { animation-name: hero-fade-in; }')
    expect(hero).toContain(":global(html[data-motion='reduced']) .hero-fade-out { animation-duration: 1ms; }")
  })
})

describe('the full-resolution poster on the hero', () => {
  it('decodes it before a slide shows and binds the looked-up one', () => {
    expect(hero).toContain("const heroArtNeeded = $derived(heroNeeds.has('keyart') || heroNeeds.has('logo') || heroNeeds.has('posterHd'))")
    expect(hero).toContain('...(currentArt?.posterHd ? { posterHd: currentArt.posterHd } : {}),')
  })
})

describe('the Home hero placeholder', () => {
  it('is a loading home.hero shaped like the hero that replaces it', () => {
    expect(home).toContain('{:else if !catalogUnavailable && hero.fetching && !heroTheme?.hidden}')
    expect(home).toContain('<div data-slot="home.hero" data-state="loading" data-variant="template" aria-hidden="true"')
    // The template box follows the hero's own scale rules: `banner` on every window, `wide` above a phone.
    expect(hero).toContain("const bannerScale = $derived(showOverlay ? heroTheme?.scale === 'banner' : seriesTheme?.bannerScale === 'banner')")
    expect(hero).toContain("const wideScale = $derived(!$isMobile && heroTheme?.scale === 'wide')")
    expect(home).toContain("const heroPlaceholderScale = $derived(heroTheme?.scale === 'banner' ? 'banner' : !$isMobile && heroTheme?.scale === 'wide' ? 'wide' : undefined)")
    expect(home).toContain("style:min-height={heroPlaceholderScale === 'wide' ? '24rem' : heroPlaceholderScale === 'banner' ? '25rem' : undefined}")
    expect(home).toContain('<div data-slot="home.hero" data-state="loading" data-variant="phone" aria-hidden="true" class="relative mx-4 mb-6 h-[46vh] overflow-hidden rounded-2xl bg-muted shadow-xl"')
    expect(home).toContain('<div data-slot="home.hero" data-state="loading" data-variant="desktop" aria-hidden="true" class="relative mb-6 h-[50vh] overflow-hidden bg-muted"')
    // The other catalogs keep their banner box, but name the hero that replaces it and show none
    // for a hidden hero, like the AniList Home.
    for (const page of [merged, catalog]) {
      expect(page).toContain(`<div data-slot="home.hero" data-state="loading" data-variant={$themePresentation?.hero?.template ? 'template' : $isMobile ? 'phone' : 'desktop'} aria-hidden="true" class="relative mb-6 h-[50vh] overflow-hidden bg-muted">`)
      expect(page).toContain('&& !$themePresentation?.hero?.hidden}')
    }
  })

  it('never counts as the featured banner for Game-mode first focus', () => {
    expect(read('../cards/ContinueRow.svelte')).toContain(`!document.querySelector('[data-slot="home.hero"]:not([data-state="loading"])')`)
  })
})
