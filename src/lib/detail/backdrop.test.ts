import { describe, expect, it } from 'vitest'
import { baseImageSrc, detailArt, isPlaceholderThumb, recordBanner, washBackground } from './backdrop'

const BANNER = 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/1-a.jpg'
const KEYART = 'https://artworks.thetvdb.com/banners/fanart/original/1.jpg'

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
    const fallback = { bannerImage: null, catalog: { provider: 'kitsu' } }
    expect(recordBanner(fallback, { loading: false, anilistBanner: BANNER })).toBe(BANNER)
    // Its own wide art when there is no AniList banner to keep.
    expect(recordBanner({ ...fallback, bannerImage: 'https://media.kitsu.app/cover.jpg' }, { loading: false })).toBe('https://media.kitsu.app/cover.jpg')
    expect(recordBanner(fallback, { loading: false })).toBeNull()
    // The AniList banner wins over the fallback's own, so the art does not swap.
    expect(recordBanner({ ...fallback, bannerImage: 'https://media.kitsu.app/cover.jpg' }, { loading: false, anilistBanner: BANNER })).toBe(BANNER)
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
