import { describe, expect, it } from 'vitest'
import { baseImageSrc, detailArt, isPlaceholderThumb, recordBanner, washBackground } from './backdrop'

const BANNER = 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/1-a.jpg'
const KEYART = 'https://artworks.thetvdb.com/banners/fanart/original/1.jpg'
const POSTER = 'https://artworks.thetvdb.com/banners/posters/1.jpg'
const COVER = 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1-a.jpg'

describe('series header art', () => {
  it('paints a banner at once, without waiting for key art', () => {
    expect(detailArt({ banner: BANNER, keyartPending: true })).toEqual({ kind: 'banner', src: BANNER })
    expect(detailArt({ banner: BANNER, keyart: KEYART })).toEqual({ kind: 'banner', src: BANNER })
  })

  it('puts key art first when the theme asks for it', () => {
    expect(detailArt({ banner: BANNER, keyart: KEYART, themeArt: 'keyart' })).toEqual({ kind: 'keyart', src: KEYART })
    // The theme's art may still arrive: wait for it rather than swap banner → key art.
    expect(detailArt({ banner: BANNER, keyartPending: true, themeArt: 'keyart' })).toEqual({ kind: 'pending' })
    // The title has none: the banner.
    expect(detailArt({ banner: BANNER, themeArt: 'keyart' })).toEqual({ kind: 'banner', src: BANNER })
    expect(detailArt({ banner: BANNER, themeArt: 'banner', keyart: KEYART })).toEqual({ kind: 'banner', src: BANNER })
  })

  it('stands key art in for a missing banner, waiting for it only while it may still come', () => {
    expect(detailArt({ banner: null, keyart: KEYART })).toEqual({ kind: 'keyart', src: KEYART })
    expect(detailArt({ banner: null, keyartPending: true })).toEqual({ kind: 'pending' })
  })

  it('waits while the record that says whether there is a banner still loads', () => {
    expect(detailArt({ banner: undefined, keyart: KEYART })).toEqual({ kind: 'pending' })
    expect(detailArt({ banner: undefined })).toEqual({ kind: 'pending' })
  })

  it('moves past art that failed its retries', () => {
    expect(detailArt({ banner: BANNER, keyart: KEYART, failed: [BANNER] })).toEqual({ kind: 'keyart', src: KEYART })
    expect(detailArt({ banner: BANNER, keyart: KEYART, themeArt: 'keyart', failed: [KEYART] })).toEqual({ kind: 'banner', src: BANNER })
    expect(detailArt({ banner: BANNER, keyart: KEYART, failed: [BANNER, KEYART], rgb: '10 20 30' })).toEqual({ kind: 'wash', rgb: '10 20 30' })
  })

  it('ends in a wash of the cover colour, never a photograph to blur', () => {
    expect(detailArt({ banner: null, rgb: '228 107 80' })).toEqual({ kind: 'wash', rgb: '228 107 80' })
    expect(detailArt({ banner: null })).toEqual({ kind: 'wash', rgb: undefined })
    expect(washBackground('228 107 80')).toContain('rgb(228 107 80 / 0.6)')
    expect(washBackground(undefined)).toContain('hsl(var(--muted))')
  })

  it('never offers a trailer still', () => {
    // The input has no trailer at all: only the banner and key art are candidates.
    const kinds = new Set<string>()
    for (const banner of [BANNER, null, undefined]) {
      for (const keyart of [KEYART, undefined]) {
        for (const themeArt of ['banner', 'keyart', undefined] as const) {
          const art = detailArt({ banner, keyart, themeArt })
          kinds.add(art.kind)
          if ('src' in art) expect(art.src).not.toMatch(/ytimg/)
        }
      }
    }
    expect([...kinds].sort()).toEqual(['banner', 'keyart', 'pending', 'wash'])
  })
})

describe('portrait header art and the cover fallback (API 4)', () => {
  it('puts key art first, then the portrait poster or cover, and never the wide banner', () => {
    const portrait = { banner: BANNER, poster: POSTER, cover: COVER, themeArt: 'portrait' } as const
    expect(detailArt({ ...portrait, keyart: KEYART })).toEqual({ kind: 'keyart', src: KEYART })
    expect(detailArt(portrait)).toEqual({ kind: 'poster', src: POSTER })
    expect(detailArt({ ...portrait, poster: undefined })).toEqual({ kind: 'poster', src: COVER })
    // The poster that failed its retries gives way to the cover; with both gone, the wash.
    expect(detailArt({ ...portrait, failed: [POSTER] })).toEqual({ kind: 'poster', src: COVER })
    expect(detailArt({ ...portrait, failed: [POSTER, COVER], rgb: '1 2 3' })).toEqual({ kind: 'wash', rgb: '1 2 3' })
    // The key art and poster lookup may still answer; the banner the record brings does not matter.
    expect(detailArt({ ...portrait, keyartPending: true })).toEqual({ kind: 'pending' })
    expect(detailArt({ banner: undefined, cover: COVER, themeArt: 'portrait' })).toEqual({ kind: 'poster', src: COVER })
  })

  it('shows the cover, sharp, when the theme asks for it in place of the wash', () => {
    expect(detailArt({ banner: null, cover: COVER, fallback: 'cover', rgb: '1 2 3' })).toEqual({ kind: 'cover', src: COVER })
    expect(detailArt({ banner: null, cover: COVER, fallback: 'wash', rgb: '1 2 3' })).toEqual({ kind: 'wash', rgb: '1 2 3' })
    expect(detailArt({ banner: null, cover: COVER, rgb: '1 2 3' })).toEqual({ kind: 'wash', rgb: '1 2 3' })
    // Only once nothing else is there: a banner, key art or a pending choice come first.
    expect(detailArt({ banner: BANNER, cover: COVER, fallback: 'cover' })).toEqual({ kind: 'banner', src: BANNER })
    expect(detailArt({ banner: null, keyart: KEYART, cover: COVER, fallback: 'cover' })).toEqual({ kind: 'keyart', src: KEYART })
    expect(detailArt({ banner: undefined, cover: COVER, fallback: 'cover' })).toEqual({ kind: 'pending' })
    expect(detailArt({ banner: null, cover: COVER, fallback: 'cover', failed: [COVER] })).toEqual({ kind: 'wash', rgb: undefined })
    expect(detailArt({ banner: null, fallback: 'cover' })).toEqual({ kind: 'wash', rgb: undefined })
  })
})

describe('the banner a record stands for', () => {
  it('reads an AniList record as it is', () => {
    expect(recordBanner({ bannerImage: BANNER }, { loading: false })).toBe(BANNER)
    expect(recordBanner({ bannerImage: null }, { loading: false })).toBeNull()
    expect(recordBanner({ bannerImage: null }, { loading: true })).toBeNull()
  })

  it('treats a card without the field as unknown while the page loads, and none once loaded', () => {
    expect(recordBanner({}, { loading: true })).toBeUndefined()
    expect(recordBanner({}, { loading: false })).toBeNull()
    expect(recordBanner(undefined, { loading: true })).toBeUndefined()
  })

  it('keeps the AniList banner for a record served by the fallback catalog', () => {
    const fallback = { bannerImage: null }
    expect(recordBanner(fallback, { loading: false, anilistBanner: BANNER, backup: true })).toBe(BANNER)
    // Its own wide art when there is no AniList banner to keep.
    expect(recordBanner({ bannerImage: 'https://media.kitsu.app/cover.jpg' }, { loading: false, backup: true })).toBe('https://media.kitsu.app/cover.jpg')
    expect(recordBanner(fallback, { loading: false, backup: true })).toBeNull()
    // The AniList banner wins over the fallback's own, so the art does not swap.
    expect(recordBanner({ bannerImage: 'https://media.kitsu.app/cover.jpg' }, { loading: false, anilistBanner: BANNER, backup: true })).toBe(BANNER)
    // An AniList record keeps its own, even none.
    expect(recordBanner(fallback, { loading: false, anilistBanner: BANNER })).toBeNull()
  })
})

describe('artwork helpers', () => {
  it("recognises YouTube's placeholder still", () => {
    expect(isPlaceholderThumb('https://i.ytimg.com/vi/abc/maxresdefault.jpg', 120)).toBe(true)
    expect(isPlaceholderThumb('https://i.ytimg.com/vi/abc/maxresdefault.jpg', 1280)).toBe(false)
    expect(isPlaceholderThumb(BANNER, 120)).toBe(false)
    // Not loaded yet (or failed outright): no width to judge.
    expect(isPlaceholderThumb('https://i.ytimg.com/vi/abc/maxresdefault.jpg', 0)).toBe(false)
  })

  it('maps a retried image back to the source the page chose', () => {
    expect(baseImageSrc(`${BANNER}?izumi_retry=2`)).toBe(BANNER)
    expect(baseImageSrc('https://x.test/a.jpg?w=1&izumi_retry=1')).toBe('https://x.test/a.jpg?w=1')
    expect(baseImageSrc(BANNER)).toBe(BANNER)
    expect(baseImageSrc(null)).toBe('')
  })
})
