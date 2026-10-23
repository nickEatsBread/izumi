import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const hero = read('./Hero.svelte')
const node = read('../themes/ThemeNode.svelte')
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
    expect(body).toContain('{#if trailer}<div class="theme-artwork relative" style={nodeStyle(item)} data-part={item.part}>{@render trailer()}</div>{/if}')
    expect(body).not.toContain('{:else}')
    expect(body).not.toContain('theme-artwork-fallback')
    expect(body).not.toContain('model[')
  })

  it('passes the trailer to the live template only, keyed by slide', () => {
    expect(hero).toContain('<ThemeNode node={heroTheme.template} model={themeModel} eager titleHeading actions={templateActions} trailer={trailerOn ? heroTrailer : undefined} />')
    expect(hero.match(/<ThemeNode [^>]*trailer=/g)?.length).toBe(1)
    expect(hero).toContain('{#snippet heroTrailer()}{#key current.id}{@render slideTrailer(current)}{/key}{/snippet}')
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
    expect(snippet).toContain('enabled={trailerOn}')
    expect(snippet).toContain('held={showOverlay && scrolled}')
    expect(snippet).toContain('dwell={showOverlay ? HERO_TRAILER_DWELL : DETAIL_TRAILER_DWELL}')
    expect(snippet).toContain("part={showOverlay ? 'hero.video' : 'detail.video'}")
    expect(snippet).toContain("mutePart={showOverlay ? 'hero.mute' : 'detail.mute'}")
    expect(hero).toContain("const trailerOn = $derived(showOverlay ? heroTheme?.preview === 'trailer' : seriesTheme?.preview === 'trailer')")
  })

  it('holds the rotation while a slide plays its trailer and moves on when it ends', () => {
    const snippet = between(hero, '{#snippet slideTrailer(media: Media)}', '{/snippet}')
    expect(snippet).toContain('onplaying={() => (trailerFor = media.id)}')
    expect(snippet).toContain('if (trailerFor === media.id) trailerFor = null')
    expect(snippet).toContain('if (natural && showOverlay && media.id === current?.id && medias.length > 1 && heroTheme?.rotate !== false) step(1)')
    expect(hero).toContain('const trailerHeld = $derived(trailerFor !== null && trailerFor === current?.id)')
    const arm = between(hero, 'const arm = () => {', '\n    }')
    expect(arm).toContain('!stalled() && !trailerHeld &&')
    // The effect also registers the scroll and hero-nav listeners: no early return on the trailer.
    expect(hero).not.toMatch(/if \(trailerHeld\) return/)
    expect(hero).toContain(":global([data-slot='home.hero']:has([data-part='hero.video'][data-state='playing'])) .hero-progress { animation-play-state: paused; }")
  })
})
