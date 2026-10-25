import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const hero = read('./Hero.svelte')
const node = read('../themes/ThemeNode.svelte')
const backdrop = read('../cards/BackdropTrailer.svelte')
const youtube = read('../cards/YoutubeTrailer.svelte')
const store = read('../../stores/trailer.ts')
const between = (src: string, start: string, end: string) => {
  const from = src.indexOf(start)
  return from < 0 ? '' : src.slice(from, src.indexOf(end, from))
}

describe('hero trailers (API 6 `hero.preview` / `detail.preview: "trailer"`)', () => {
  it('lets a hero template place the trailer with the `trailer` artwork kind, and nothing without one', () => {
    expect(node).toContain('trailer?: Snippet')
    const branch = node.indexOf("{:else if item.type === 'artwork' && item.artwork === 'trailer'}")
    const artwork = node.indexOf("{:else if item.type === 'artwork'}")
    expect(branch).toBeGreaterThan(-1)
    // Before the image branch, so `model.trailer` is never read as an image.
    expect(branch).toBeLessThan(artwork)
    const body = node.slice(branch, artwork)
    expect(body).toContain('{#if trailer}<div class="theme-artwork relative" style={nodeStyle(item, unit)} data-part={item.part}>{@render trailer()}</div>{/if}')
    expect(body).not.toContain('{:else}')
    expect(body).not.toContain('theme-artwork-fallback')
    expect(body).not.toContain('model[')
  })

  it('passes the trailer to the live template only, keyed by slide', () => {
    expect(hero).toContain('<ThemeNode node={heroTheme.template} model={themeModel} eager titleHeading actions={templateActions} trailer={trailerOn ? heroTrailer : undefined} />')
    expect(hero.match(/<ThemeNode [^>]*trailer=/g)?.length).toBe(1)
    expect(hero).toContain('{#snippet heroTrailer()}{@render slideTrailer(current)}{/snippet}')
  })

  it('plays over the desktop slide art, under the scrims', () => {
    const desktop = hero.slice(hero.indexOf('data-variant="desktop"'))
    const slide = between(desktop, '{#key current.id}', '{/key}')
    expect(slide).toContain('data-part="hero.slide"')
    expect(slide).toContain('{@render slideTrailer(current)}')
    expect(slide.indexOf('{@render slideTrailer(current)}')).toBeGreaterThan(slide.lastIndexOf('{/if}'))
    expect(desktop.indexOf('{@render slideTrailer(current)}')).toBeLessThan(desktop.indexOf('data-part="hero.scrim"'))
    // The phone card has none.
    expect(between(hero, 'data-variant="phone"', 'data-variant="desktop"')).not.toContain('slideTrailer')
  })

  it('uses the hero hooks and dwell on Home and the detail ones on the series banner', () => {
    const snippet = between(hero, '{#snippet slideTrailer(media: Media)}', '{/snippet}')
    expect(snippet).toContain('<BackdropTrailer')
    expect(snippet).toContain('id={youtubeTrailerId(media.trailer)}')
    expect(snippet).toContain('enabled={trailerOn && !played.has(slide)}')
    // Scrolling away holds it inside BackdropTrailer, on Home and the series page alike.
    expect(snippet).not.toContain('held=')
    expect(snippet).toContain('dwell={showOverlay ? HERO_TRAILER_DWELL : DETAIL_TRAILER_DWELL}')
    expect(snippet).toContain("part={showOverlay ? 'hero.video' : 'detail.video'}")
    expect(snippet).toContain("mutePart={showOverlay ? 'hero.mute' : 'detail.mute'}")
    // A width-scaled series banner sits under the page content, where its mute button cannot be clicked.
    expect(hero).toContain("const trailerOn = $derived(showOverlay ? heroTheme?.preview === 'trailer' : seriesTheme?.preview === 'trailer' && !bannerScale)")
  })

  it('holds the rotation while a slide plays its trailer and moves on when it ends', () => {
    const snippet = between(hero, '{#snippet slideTrailer(media: Media)}', '{/snippet}')
    expect(snippet).toContain('onplaying={() => (trailerFor = slide)}')
    expect(snippet).toContain('if (trailerFor === slide) trailerFor = null')
    expect(snippet).toContain('if (natural && showOverlay && slide === current?.id && medias.length > 1 && heroTheme?.rotate !== false) step(1)')
    // Stopped early: the timer restarts a full interval and `cycle` restarts the marker with it, without stepping.
    expect(snippet).toContain('if (!natural && slide === current?.id) cycle += 1')
    expect(hero).toContain('const trailerHeld = $derived(trailerFor !== null && trailerFor === current?.id)')
    const arm = between(hero, 'const arm = () => {', '\n    }')
    expect(arm).toContain('!stalled() && !trailerHeld &&')
    // The effect also registers the scroll and hero-nav listeners: no early return on the trailer.
    expect(hero).not.toMatch(/if \(trailerHeld\) return/)
    expect(hero).toContain(":global([data-slot='home.hero']:has([data-part='hero.video'][data-state='playing'])) .hero-progress { animation-play-state: paused; }")
  })

  it("gives each slide's callbacks that slide's id, never the live getter, and clears the hold on every slide change", () => {
    // Snippet arguments are getters, so `media.id` in a callback would read the slide current when it runs.
    const snippet = between(hero, '{#snippet slideTrailer(media: Media)}', '{/snippet}')
    expect(snippet).toContain('{#each [media.id] as slide (slide)}')
    expect(snippet.slice(snippet.indexOf('onplaying='))).not.toContain('media.id')
    const commit = between(hero, 'function commitSlide(n: number, direction: 1 | -1, ready: boolean) {', 'scheduleWarm()')
    expect(commit).toContain('if (n !== i) trailerFor = null')
    expect(commit.indexOf('trailerFor = null')).toBeLessThan(commit.indexOf('i = n'))
  })

  it("plays each slide's trailer at most once per Home visit", () => {
    expect(hero).toContain('const played = new Set<number>()')
    expect(between(hero, '{#snippet slideTrailer(media: Media)}', '{/snippet}')).toContain('if (natural) played.add(slide)')
  })

  it("fades a backdrop trailer's mute button away while idle, never a hover preview's", () => {
    const idle = between(youtube, 'let idle = $state(false)', 'function fail()')
    // Backdrop trailers only (the hover previews loop), and only while one plays.
    expect(idle).toContain('if (loop || !playing) return')
    expect(idle).toContain('idleTimer = setTimeout(() => (idle = true), 3000)')
    for (const type of ["'pointermove'", "'keydown'"]) {
      expect(idle).toContain(`window.addEventListener(${type}, wake`)
      expect(idle).toContain(`window.removeEventListener(${type}, wake`)
    }
    expect(idle).toContain('clearTimeout(idleTimer)')
    // M is consumed before the window listener hears it, so the toggle wakes the button itself.
    expect(between(youtube, 'function toggleMute() {', '\n  }')).toContain('if (!loop) wake()')
    const button = between(youtube, '<button\n      data-part={mutePart}', '>\n')
    expect(button).toContain('data-idle={(idle && !focusVisible) || undefined}')
    expect(button).toContain("onfocus={(e) => (focusVisible = e.currentTarget.matches(':focus-visible'))}")
    expect(button).toContain('onblur={() => (focusVisible = false)}')
    // A fade, which app.css drops under reduced motion.
    expect(button).toContain("transition-opacity duration-300 {idle && !focusVisible ? 'opacity-0' : ''}")
  })

  it('never plays a backdrop trailer alongside the full dialog or a hover preview', () => {
    expect(store).toContain('export const hoverTrailers = writable(0)')
    expect(backdrop).toContain("import { backdropTrailerMuted, hoverTrailers, trailerPopup } from '$lib/stores/trailer'")
    expect(backdrop).toContain('held: held || scrolled || $trailerPopup !== null || $hoverTrailers > 0')
    // WebView2 keeps a minimised window's page visible, so the window state stops it too.
    expect(backdrop).toContain('pageHidden: pageHidden || $windowMinimized')
    // Only the looping hover previews count, once each, and release on teardown.
    expect(youtube).toContain('const hover = loop')
    expect(youtube).toContain('if (hover) hoverTrailers.update((n) => n + 1)')
    expect(youtube).toContain('if (hover) hoverTrailers.update((n) => n - 1)')
  })
})
