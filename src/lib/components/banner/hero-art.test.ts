import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Media } from '$lib/anilist/types'
import { heroBackdrop, heroNeedsKeyart, trailerStill } from './hero-art'

const BANNER = 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/1.jpg'
const KEYART = 'https://artworks.thetvdb.com/banners/v4/series/1/backgrounds/a.jpg'
const COVER = 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/1.jpg'
const STILL = 'https://i.ytimg.com/vi/abc/maxresdefault.jpg'
const media = (extra: Partial<Media> = {}): Media => ({
  id: 1, title: { romaji: 'T' }, coverImage: { extraLarge: COVER }, trailer: { id: 'abc', site: 'youtube' }, ...extra,
}) as Media

describe('the Home hero backdrop', () => {
  it("keeps izumi's own order for a title with a banner", () => {
    expect(heroBackdrop(media({ bannerImage: BANNER }), undefined)).toBe(BANNER)
    expect(heroBackdrop(media({ bannerImage: BANNER }), undefined, 'banner-cover')).toBe(BANNER)
    expect(heroNeedsKeyart(media({ bannerImage: BANNER }))).toBe(false)
  })

  it('shows key art before a trailer still, and the still only when there is no key art', () => {
    expect(heroBackdrop(media(), KEYART)).toBe(KEYART)
    expect(heroBackdrop(media(), null)).toBe(STILL)
    // A still YouTube answered with its grey placeholder (or that failed) gives way to the cover.
    expect(heroBackdrop(media(), null, 'banner', [STILL])).toBe(COVER)
    expect(heroBackdrop(media({ trailer: null }), null)).toBe(COVER)
  })

  it('never shows a trailer still under `banner-cover`', () => {
    expect(heroBackdrop(media(), KEYART, 'banner-cover')).toBe(KEYART)
    expect(heroBackdrop(media(), null, 'banner-cover')).toBe(COVER)
  })

  it('waits for the key art of a title without a banner, and never for one with a broken banner', () => {
    expect(heroBackdrop(media(), undefined)).toBe('')
    expect(heroBackdrop(media(), undefined, 'banner-cover')).toBe('')
    expect(heroBackdrop(media({ bannerImage: BANNER }), undefined, 'banner', [BANNER])).toBe(STILL)
    expect(heroBackdrop(media({ bannerImage: BANNER }), undefined, 'banner-cover', [BANNER])).toBe(COVER)
    expect(heroBackdrop(media(), KEYART, 'banner', [KEYART])).toBe(STILL)
  })

  it('reads the trailer still banner() falls back to', () => {
    expect(trailerStill(media())).toBe(STILL)
    expect(trailerStill(media({ trailer: { id: 'x', site: 'dailymotion' } as Media['trailer'] }))).toBeUndefined()
    expect(trailerStill(media({ trailer: { id: 'abc' } as Media['trailer'] }))).toBe(STILL)
  })
})

describe('the hero wiring', () => {
  const hero = readFileSync(fileURLToPath(new URL('./Hero.svelte', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
  it("looks key art up for banner-less slides only where wide art shows: izumi's desktop banner or `banner-cover`", () => {
    expect(hero).toContain("const backdropLookups = $derived(showOverlay && !artwork && (heroTheme?.template ? heroTheme.art === 'banner-cover' : !$isMobile && artworkMode === 'backdrop'))")
    expect(hero).toContain('if (!heroNeedsKeyart(media) || requestedKeyart.has(media.id)) continue')
    expect(hero).toContain('void loadTitleExtras(media, KEYART_ONLY).then((value) => {')
  })
  it("paints izumi's own desktop banner and decodes it through the same choice", () => {
    expect(hero).toContain("const homeBackdrop = (m: Media) => heroBackdrop(m, keyartOf(m), heroTheme?.art ?? 'banner', failedArtwork)")
    expect(hero).toContain('if (showOverlay) return homeBackdrop(current)')
    expect(hero).toContain("return [artworkMode === 'cover' || ($isMobile && showOverlay) ? cover(m) : showOverlay ? homeBackdrop(m) : banner(m)]")
  })
  it("binds a template's backdrop to the choice only under `banner-cover`, so older themes keep banner()", () => {
    expect(hero).toContain("backdrop: heroTheme?.art === 'banner-cover' ? templateBackdrop(current) || undefined : banner(current),")
  })
  it('stops waiting for the current slide with the extras wait', () => {
    expect(hero).toContain('return m.id === current?.id && extrasWaitOver ? null : undefined')
  })
  it('keeps the placeholder of a slide committed while its key art is still on its way', () => {
    expect(hero).toContain('if (backdropLookups && !heroTheme?.template && current && !backdropSrc && loadedArtworkId === current.id) loadedArtworkId = null')
  })
})
