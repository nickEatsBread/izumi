import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const hero = readFileSync(fileURLToPath(new URL('./Hero.svelte', import.meta.url)), 'utf8')

describe('featured carousel UX', () => {
  it('shows a live next-episode countdown', () => {
    // Live tick, but paced by the label's granularity: 1 s only inside the final minute.
    expect(hero).toContain('setInterval(() => (clock = Date.now()), heroClockTickMs)')
    expect(hero).toContain("nextAiringAt - clock / 1000 < 90 ? 1_000 : 15_000")
    expect(hero).toContain('`Episode ${nextAiring.episode} in ${airingCountdown(nextAiringAt, clock)}`')
    expect(hero).toContain('`Episode ${nextAiring.episode} airs in ${airingCountdownAccessible(nextAiringAt, clock)}`')
    expect(hero.match(/aria-label=\{nextAiringAccessibleLabel\}/g)?.length).toBe(2)
    expect(hero.match(/font-black tabular-nums/g)?.length).toBe(2)
  })

  it('combines airing context and genres beneath a compact discovery-facts row', () => {
    expect(hero).toContain("current?.studios?.nodes?.[0]?.name || season(current)")
    expect(hero).toContain('{#if nextAiringLabel || current.genres?.length}')
    expect(hero).toContain('{current.averageScore}% score')
    expect(hero).toContain('{totalEpisodes(current)} episodes')
  })

  it('anchors the featured rank to a corner of the banner', () => {
    expect(hero.match(/\{featuredRankLabel\}/g)?.length).toBe(2)
    // The rank says where the carousel placed the title, not a fact about the title, so both
    // layouts keep it in the banner's own corner instead of among the title's facts.
    // Desktop: pinned to the artwork's bottom-right corner, clearing the carousel dots when the
    // carousel has more than one title.
    expect(hero).toContain('pointer-events-none absolute right-8')
    expect(hero).toContain('class:bottom-16={medias.length > 1}')
    expect(hero).toContain('class:bottom-8={medias.length <= 1}')
    // Phone: the card's copy fills its bottom, so the chip takes the top-right corner over the
    // artwork. A row of its own under Watch and Details read as a stray element after the actions.
    // Copy and chip share one wrapping layer, so a card too short for both (a phone in landscape)
    // clips the chip instead of drawing it over the title.
    const phone = hero.slice(hero.indexOf('data-variant="phone"'), hero.indexOf('data-variant="desktop"'))
    const layer = phone.indexOf('pointer-events-none absolute inset-0 z-20 flex flex-col-reverse flex-wrap justify-between')
    const copy = phone.indexOf('<div class="flex w-full flex-col gap-2 p-4">')
    const corner = phone.indexOf('<div class="mr-3 mt-3 flex max-w-[calc(100%-1.5rem)] self-end">')
    expect(layer).toBeGreaterThan(-1)
    expect(copy).toBeGreaterThan(layer)
    expect(corner).toBeGreaterThan(copy)
    // The copy column closes before the corner slot opens: the chip is its sibling, not a row in it.
    const between = phone.slice(copy, corner)
    expect(between.match(/<div\b/g)?.length).toBe(between.match(/<\/div>/g)?.length)
    expect(phone.indexOf('{featuredRankLabel}')).toBeGreaterThan(corner)
    expect(phone.indexOf('<ThemeNode node={heroTheme.rank}')).toBeGreaterThan(corner)
    expect(phone).not.toContain('flex justify-end')
  })

  it('uses provider title artwork with a readable text fallback', () => {
    expect(hero).toContain('const currentLogo = $derived(current?.logoImage')
    expect(hero.match(/src=\{currentLogo\}/g)?.length).toBe(2)
    expect(hero.match(/\{:else\}\s*<h1/g)?.length).toBeGreaterThanOrEqual(2)
    expect(hero).toContain('onerror={logoFailed}')
    expect(hero).toContain('(event.currentTarget as HTMLImageElement).src')
    expect(hero.match(/<h1 data-part="hero\.logo" aria-label=\{title\(current\)\}/g)?.length).toBe(2)
  })

  it('reveals explicit edge navigation and animates in the requested direction', () => {
    expect(hero).toContain('aria-label="Previous featured title"')
    expect(hero).toContain('aria-label="Next featured title"')
    expect(hero).toContain('hero-slide-in')
    expect(hero).toContain('--hero-enter-x:{navDirection * 3}%')
  })

  it('keeps a skeleton visible until the active artwork has loaded', () => {
    expect(hero).toContain('const artworkReady = $derived(loadedArtworkId === current?.id)')
    expect(hero.match(/\{#if !artworkReady\}<div class="absolute inset-0 skeloader"><\/div>\{\/if\}/g)?.length).toBe(2)
    // Mobile and the desktop full cover. The desktop backdrop settles on load only: a failure (after
    // its retries) or YouTube's placeholder still steps to the next artwork instead of settling on
    // an empty or grey hero (WebKitGTK fires `error` on a 404).
    expect(hero.match(/onload=\{artworkSettled\} onerror=\{artworkSettled\}/g)?.length).toBe(2)
    expect(hero).toContain('use:headerImage={{ src: backdropSrc, onfailed: backdropFailed }}')
    expect(hero).toContain('if (isPlaceholderThumb(src, image.naturalWidth)) backdropFailed(src)')
    expect(hero).toContain("return wide && !failedArtwork.includes(wide) ? wide : cover(current)")
  })

  it('keeps pointer-only carousel controls out of Steam Deck spatial navigation', () => {
    expect(hero.match(/data-focusable=\{controllerUi \? undefined : ''\}/g)?.length).toBeGreaterThanOrEqual(3)
    expect(hero.match(/tabindex=\{controllerUi \? -1 : undefined\}/g)?.length).toBeGreaterThanOrEqual(3)
    expect(hero).toContain('theme-banner-scale')
    expect(hero).toContain('hero-pip')
  })

  it('makes Watch Now the row entry target and reveals the complete hero', () => {
    expect(hero).toMatch(/<div\s+data-slot=\{showOverlay \? 'home\.hero' : 'detail\.banner'\}\s+data-variant="desktop"\s+data-nav-row/)
    expect(hero).toContain('<div data-part="hero.actions" data-nav-row-items class="mt-4 flex items-center gap-2">')
    expect(hero).toContain('<button data-part="button" data-variant="primary" data-focusable data-nav-row-default data-nav-scroll-top')
  })

  it('steps directionally after an enabled mouse drag', () => {
    expect(hero).toContain("import { dragCarousels, wheelScrollAcross } from '$lib/settings/ui'")
    expect(hero).toContain("e.pointerType !== 'mouse'")
    expect(hero).toContain('if (!$dragCarousels')
    expect(hero).toContain('Math.abs(dx) >= 48')
    expect(hero).toContain('step(dx < 0 ? 1 : -1)')
    expect(hero).toContain('onpointercancel={(e) => endHeroPointer(e, false)}')
  })

  it('steps once per two-finger horizontal trackpad gesture', () => {
    expect(hero).toContain('dragCarousels, wheelScrollAcross')
    expect(hero).toContain('Math.abs(e.deltaX) <= Math.abs(e.deltaY)')
    expect(hero).toContain('if (Math.abs(heroWheelTotal) < 24) return')
    expect(hero).toContain('now - heroWheelSteppedAt > 160')
    expect(hero).toContain('magnitude >= Math.max(10, heroWheelLastMagnitude * 1.8)')
    expect(hero).toContain('if (!freshGesture) return')
    expect(hero).toContain('step(heroWheelTotal < 0 ? -1 : 1)')
    expect(hero).toContain('onwheel={onHeroWheel}')
  })

  it('uses the compact Game-mode detail backdrop height', () => {
    expect(hero).toContain("bannerScale ? 'theme-banner-scale mb-0' : seriesBannerHeight ? '' : showOverlay ? 'sm:h-[50vh]' : controllerUi ? 'sm:h-[42vh]' : 'sm:h-[48vh]'")
    expect(hero).toContain("controllerUi ? 'sm:h-[42vh]' : 'sm:h-[48vh]'")
  })

  it('keeps genre labels near-white over variable artwork', () => {
    expect(hero.match(/font-bold text-white\/90/g)?.length).toBeGreaterThanOrEqual(2)
  })
})
