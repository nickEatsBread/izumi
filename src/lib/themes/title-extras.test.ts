import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Media } from '$lib/anilist/types'

const mocks = vi.hoisted(() => ({
  fetchAniZip: vi.fn(),
  fetchMalRating: vi.fn(),
  getScheduleInfo: vi.fn(),
  getScheduleInfoMany: vi.fn(),
  tmdb: vi.fn(),
  locale: 'en',
}))
vi.mock('$lib/anizip', () => ({ fetchAniZip: mocks.fetchAniZip }))
vi.mock('$lib/anilist/jikan', () => ({ fetchMalRating: mocks.fetchMalRating }))
vi.mock('$lib/catalog/providers/tmdb', () => ({ tmdb: mocks.tmdb }))
vi.mock('$lib/paraglide/runtime.js', () => ({ getLocale: () => mocks.locale }))
vi.mock('$lib/anime/animeschedule', () => ({
  getScheduleInfo: mocks.getScheduleInfo,
  getScheduleInfoMany: mocks.getScheduleInfoMany,
  scheduleTitles: (t: { romaji?: string; english?: string }) => [t.romaji, t.english],
}))

import { ART_EXTRAS, artNeeds, audioLabel, clearTitleExtrasCache, languageCode, loadTitleExtras, logoLanguages, malAgeRating, metaNeeds, nativeLanguage, peekTitleArt, pickTitleArt, pickTitleLogo, primeTitleExtras, templateNeeds, titleExtrasKey } from './title-extras'
import { tmdbReadToken } from '$lib/settings/catalog'
import type { ThemeNode } from './presentation'

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const FANART = 'https://artworks.thetvdb.com/banners/v4/series/424536/backgrounds/64e6cbe29d9c0.jpg'
const LOGO = 'https://artworks.thetvdb.com/banners/v4/series/424536/clearlogo/696a802a5aa22.png'
const POSTER = 'https://artworks.thetvdb.com/banners/v4/series/424536/posters/64e6cb7b4d5ba.jpg'
const media = (extra: Partial<Media> = {}): Media => ({ id: 154587, idMal: 52991, title: { romaji: 'Sousou no Frieren', english: 'Frieren' }, ...extra }) as Media
const all = new Set(['keyart', 'logo', 'ageRating', 'audio'] as const)

beforeEach(() => {
  clearTitleExtrasCache()
  for (const mock of [mocks.fetchAniZip, mocks.fetchMalRating, mocks.getScheduleInfo, mocks.getScheduleInfoMany, mocks.tmdb]) mock.mockReset()
  mocks.locale = 'en'
  tmdbReadToken.set('')
  mocks.fetchAniZip.mockResolvedValue({ images: [
    { coverType: 'Banner', url: 'https://artworks.thetvdb.com/banners/v4/series/424536/banners/a.jpg' },
    { coverType: 'Fanart', url: FANART },
    { coverType: 'Clearlogo', url: LOGO },
  ] })
  mocks.fetchMalRating.mockResolvedValue('PG-13 - Teens 13 or older')
  mocks.getScheduleInfo.mockResolvedValue({ route: 'sousou-no-frieren', dubbed: true })
  mocks.getScheduleInfoMany.mockResolvedValue(new Map())
})

describe('templateNeeds', () => {
  it('collects the extras a template binds as artwork, fields or conditions', () => {
    const node: ThemeNode = { type: 'stack', children: [
      { type: 'artwork', artwork: 'keyart' },
      { type: 'text', field: 'title', when: { field: 'logo', absent: true } },
      { type: 'row', children: [{ type: 'text', field: 'ageRating' }, { type: 'text', field: 'genres' }] },
    ] }
    expect([...templateNeeds(node)].sort()).toEqual(['ageRating', 'keyart', 'logo'])
    expect(templateNeeds(undefined).size).toBe(0)
    expect([...templateNeeds({ type: 'text', field: 'audio' }, { type: 'artwork', artwork: 'poster' })]).toEqual(['audio'])
  })
})

describe('pickTitleArt', () => {
  it('takes the 16:9 background as key art and only real clear logos', () => {
    expect(pickTitleArt([{ coverType: 'Fanart', url: FANART }, { coverType: 'Clearlogo', url: LOGO }])).toEqual({ keyart: FANART, logo: LOGO })
    expect(pickTitleArt([{ coverType: 'Clearlogo', url: 'https://artworks.thetvdb.com/banners/images/icons/1.png' }])).toEqual({ keyart: undefined, logo: undefined })
    expect(pickTitleArt([{ coverType: 'Fanart', url: 'http://artworks.thetvdb.com/x/backgrounds/1.jpg' }]).keyart).toBeUndefined()
    expect(pickTitleArt(undefined)).toEqual({ keyart: undefined, logo: undefined })
  })
  it('takes the TVDB poster as the full-resolution portrait art (API 4 `posterHd`)', () => {
    expect(pickTitleArt([{ coverType: 'Poster', url: POSTER }, { coverType: 'Fanart', url: FANART }])).toEqual({ keyart: FANART, posterHd: POSTER })
    expect(pickTitleArt([{ coverType: 'Poster', url: 'http://artworks.thetvdb.com/x/posters/1.jpg' }]).posterHd).toBeUndefined()
  })
})

describe('title logo language', () => {
  const JA = 'https://artworks.thetvdb.com/banners/v4/series/1/clearlogo/ja.png'
  const EN = 'https://artworks.thetvdb.com/banners/v4/series/1/clearlogo/en.png'
  const DE = 'https://artworks.thetvdb.com/banners/v4/series/1/clearlogo/de.png'
  const logo = (url: string, language?: string) => ({ coverType: 'Clearlogo', url, ...(language ? { language } : {}) })
  it("prefers a logo in the app language, then English, then the title's own, then none", () => {
    expect(pickTitleLogo([logo(JA, 'jpn'), logo(EN, 'eng')], ['en'])).toBe(EN)
    expect(pickTitleLogo([logo(EN, 'en'), logo(JA, 'ja')], ['ja', 'en'])).toBe(JA)
    expect(pickTitleLogo([logo(JA, 'jpn')], ['en'])).toBe(JA)
    // A logo in a language that is neither wanted nor the title's own is never used.
    expect(pickTitleLogo([logo(DE, 'deu')], ['en'])).toBeUndefined()
    expect(pickTitleLogo([logo(DE, 'de'), logo(JA, 'ja')], ['en'])).toBe(JA)
    expect(pickTitleLogo([logo(JA, 'kor')], ['en'], 'ko')).toBe(JA)
    expect(pickTitleLogo([], ['en'])).toBeUndefined()
  })
  it("keeps the untagged logo ani.zip carries today as the title's own", () => {
    expect(pickTitleLogo([logo(JA)], ['en'])).toBe(JA)
    expect(pickTitleLogo([logo(JA), logo(EN, 'en')], ['en'])).toBe(EN)
    expect(pickTitleArt([{ coverType: 'Fanart', url: FANART }, logo(JA), logo(EN, 'eng')], ['en'])).toEqual({ keyart: FANART, logo: EN, posterHd: undefined })
  })
  it('reads language tags in either ISO form', () => {
    expect(languageCode('eng')).toBe('en')
    expect(languageCode('jpn')).toBe('ja')
    expect(languageCode('en-US')).toBe('en')
    expect(languageCode('JA')).toBe('ja')
    expect(languageCode('')).toBeUndefined()
    expect(languageCode(null)).toBeUndefined()
    expect(languageCode('xx-yy-zz')).toBe('xx')
  })
  it('wants the app language first, then English', () => {
    expect(logoLanguages('en')).toEqual(['en'])
    expect(logoLanguages('ja')).toEqual(['ja', 'en'])
    mocks.locale = 'ja'
    expect(logoLanguages()).toEqual(['ja', 'en'])
    expect(nativeLanguage('JP')).toBe('ja')
    expect(nativeLanguage('KR')).toBe('ko')
    expect(nativeLanguage(undefined)).toBe('ja')
  })
})

describe('an English title logo from TMDB', () => {
  const TMDB_EN = '/en-logo.png'
  const anizip = { images: [{ coverType: 'Fanart', url: FANART }, { coverType: 'Clearlogo', url: LOGO }], mappings: { themoviedb_id: '209867' } }
  beforeEach(() => {
    mocks.fetchAniZip.mockResolvedValue(anizip)
    mocks.tmdb.mockResolvedValue({ logos: [{ file_path: '/ja-logo.png', iso_639_1: 'ja', vote_average: 9 }, { file_path: TMDB_EN, iso_639_1: 'en', vote_average: 5 }] })
  })
  it('is never asked for without a TMDB token: the TVDB logo stays', async () => {
    await expect(loadTitleExtras(media(), new Set(['logo']))).resolves.toEqual({ logo: LOGO })
    expect(mocks.tmdb).not.toHaveBeenCalled()
  })
  it('replaces the untagged TVDB logo once TMDB is set up, for the series or the film ani.zip maps', async () => {
    tmdbReadToken.set('token')
    await expect(loadTitleExtras(media(), new Set(['logo']))).resolves.toEqual({ logo: `https://image.tmdb.org/t/p/w500${TMDB_EN}` })
    expect(mocks.tmdb).toHaveBeenCalledWith('/tv/209867/images', { include_image_language: 'en' })
    clearTitleExtrasCache()
    await loadTitleExtras(media({ id: 5, format: 'MOVIE' }), new Set(['logo']))
    expect(mocks.tmdb).toHaveBeenLastCalledWith('/movie/209867/images', { include_image_language: 'en' })
  })
  it('keeps the TVDB logo when TMDB has none in a wanted language, or fails', async () => {
    tmdbReadToken.set('token')
    mocks.tmdb.mockResolvedValue({ logos: [{ file_path: '/ja-logo.png', iso_639_1: 'ja' }, { file_path: '/x.png', iso_639_1: null }] })
    await expect(loadTitleExtras(media(), new Set(['logo']))).resolves.toEqual({ logo: LOGO })
    clearTitleExtrasCache()
    mocks.tmdb.mockRejectedValue(new Error('401'))
    await expect(loadTitleExtras(media(), new Set(['logo', 'keyart']))).resolves.toEqual({ logo: LOGO, keyart: FANART })
  })
  it('skips TMDB when ani.zip already has a logo in a wanted language', async () => {
    tmdbReadToken.set('token')
    mocks.fetchAniZip.mockResolvedValue({ images: [{ coverType: 'Clearlogo', url: LOGO, language: 'eng' }], mappings: { themoviedb_id: '209867' } })
    await expect(loadTitleExtras(media(), new Set(['logo']))).resolves.toEqual({ logo: LOGO })
    expect(mocks.tmdb).not.toHaveBeenCalled()
  })
  it('never holds key art or the poster back for it', async () => {
    tmdbReadToken.set('token')
    mocks.tmdb.mockReturnValue(new Promise(() => {}))
    await expect(loadTitleExtras(media(), new Set(['keyart', 'posterHd']))).resolves.toEqual({ keyart: FANART })
    expect(mocks.tmdb).not.toHaveBeenCalled()
  })
  it('is what a page opened again paints first', async () => {
    tmdbReadToken.set('token')
    await loadTitleExtras(media(), new Set(['logo']))
    expect(peekTitleArt(154587)).toMatchObject({ keyart: FANART, logo: `https://image.tmdb.org/t/p/w500${TMDB_EN}` })
  })
  it('asks in the app language first', async () => {
    tmdbReadToken.set('token')
    mocks.locale = 'ja'
    await expect(loadTitleExtras(media(), new Set(['logo']))).resolves.toEqual({ logo: 'https://image.tmdb.org/t/p/w500/ja-logo.png' })
    expect(mocks.tmdb).toHaveBeenCalledWith('/tv/209867/images', { include_image_language: 'ja,en' })
  })
})

describe('labels', () => {
  it('shortens MyAnimeList ratings to badges', () => {
    expect(malAgeRating('G - All Ages')).toBe('G')
    expect(malAgeRating('PG - Children')).toBe('PG')
    expect(malAgeRating('PG-13 - Teens 13 or older')).toBe('13+')
    expect(malAgeRating('R - 17+ (violence & profanity)')).toBe('17+')
    expect(malAgeRating('R+ - Mild Nudity')).toBe('18+')
    expect(malAgeRating('Rx - Hentai')).toBe('18+')
    expect(malAgeRating('None')).toBeUndefined()
    expect(malAgeRating(null)).toBeUndefined()
  })
  it('words audio from the schedule record, and says nothing when the title is unknown', () => {
    expect(audioLabel({ dubbed: true } as never)).toBe('Sub | Dub')
    expect(audioLabel({ dubbed: false } as never)).toBe('Subtitled')
    expect(audioLabel(null)).toBeUndefined()
  })
})

describe('loadTitleExtras', () => {
  it('loads every requested extra for an AniList title', async () => {
    await expect(loadTitleExtras(media(), all)).resolves.toEqual({ keyart: FANART, logo: LOGO, ageRating: '13+', audio: 'Sub | Dub' })
    expect(mocks.fetchAniZip).toHaveBeenCalledWith(154587)
    expect(mocks.fetchMalRating).toHaveBeenCalledWith(52991)
    expect(mocks.getScheduleInfo).toHaveBeenCalledWith(154587, ['Sousou no Frieren', 'Frieren'])
  })
  it('returns only what was asked and fetches nothing else', async () => {
    await expect(loadTitleExtras(media(), new Set(['logo']))).resolves.toEqual({ logo: LOGO })
    expect(mocks.fetchMalRating).not.toHaveBeenCalled()
    expect(mocks.getScheduleInfo).not.toHaveBeenCalled()
  })
  it('prefers provider artwork and certifications', async () => {
    const tmdb = media({ catalog: { provider: 'tmdb', id: '209867', type: 'series' }, bannerImage: 'https://image.tmdb.org/t/p/original/b.jpg', logoImage: 'https://image.tmdb.org/t/p/original/l.png', contentRating: 'TV-14', idMal: undefined })
    const extras = await loadTitleExtras(tmdb, new Set(['keyart', 'logo', 'ageRating']))
    expect(extras).toMatchObject({ keyart: 'https://image.tmdb.org/t/p/original/b.jpg', logo: 'https://image.tmdb.org/t/p/original/l.png', ageRating: 'TV-14' })
    expect(mocks.fetchMalRating).not.toHaveBeenCalled()
  })
  it('never fails: a broken source leaves its extra out', async () => {
    mocks.fetchAniZip.mockRejectedValue(new Error('offline'))
    mocks.fetchMalRating.mockRejectedValue(new Error('429'))
    mocks.getScheduleInfo.mockResolvedValue(null)
    await expect(loadTitleExtras(media({ id: 1 }), all)).resolves.toEqual({})
  })
  it('asks ani.zip once per title while the art is cached', async () => {
    await loadTitleExtras(media(), new Set(['keyart']))
    await loadTitleExtras(media(), new Set(['logo']))
    expect(mocks.fetchAniZip).toHaveBeenCalledTimes(1)
  })
  it('looks the full-resolution poster up in the same ani.zip record, only when a template binds it', async () => {
    const node: ThemeNode = { type: 'artwork', artwork: 'posterHd', when: { field: 'posterHd' } }
    expect([...templateNeeds(node)]).toEqual(['posterHd'])
    mocks.fetchAniZip.mockResolvedValue({ images: [{ coverType: 'Fanart', url: FANART }, { coverType: 'Poster', url: POSTER }] })
    await expect(loadTitleExtras(media(), new Set(['posterHd']))).resolves.toEqual({ posterHd: POSTER })
    await expect(loadTitleExtras(media(), new Set(['keyart']))).resolves.toEqual({ keyart: FANART })
    expect(mocks.fetchAniZip).toHaveBeenCalledTimes(1)
    expect(peekTitleArt(154587)).toMatchObject({ keyart: FANART, posterHd: POSTER })
    // A title without an AniList identity has none to look up: the host binds its cover instead.
    const tmdb = media({ id: -5, catalog: { provider: 'tmdb', id: '5', type: 'series' }, idMal: undefined })
    await expect(loadTitleExtras(tmdb, new Set(['posterHd']))).resolves.toEqual({})
  })
  it('treats an ani.zip record it cannot read as no art, and asks again next time', async () => {
    mocks.fetchAniZip.mockResolvedValue({ images: 'not a list' })
    await expect(loadTitleExtras(media(), new Set(['keyart', 'logo']))).resolves.toEqual({})
    await loadTitleExtras(media(), new Set(['keyart']))
    expect(mocks.fetchAniZip).toHaveBeenCalledTimes(2)
  })
})

describe('art and metadata needs', () => {
  it('splits the artwork a template binds from the slower lookups', () => {
    expect([...ART_EXTRAS].sort()).toEqual(['keyart', 'logo', 'posterHd'])
    expect([...artNeeds(new Set(['posterHd', 'audio']))]).toEqual(['posterHd'])
    expect([...artNeeds(all)].sort()).toEqual(['keyart', 'logo'])
    expect([...metaNeeds(all)].sort()).toEqual(['ageRating', 'audio'])
    expect(artNeeds(new Set(['audio'])).size).toBe(0)
    expect(metaNeeds(new Set(['logo'])).size).toBe(0)
  })
  it('resolves the art while the rating and the schedule are still pending', async () => {
    mocks.fetchMalRating.mockReturnValue(new Promise(() => {}))
    mocks.getScheduleInfo.mockReturnValue(new Promise(() => {}))
    let metaSettled = false
    void loadTitleExtras(media(), metaNeeds(all)).then(() => { metaSettled = true })
    await expect(loadTitleExtras(media(), artNeeds(all))).resolves.toEqual({ keyart: FANART, logo: LOGO })
    expect(metaSettled).toBe(false)
    expect(mocks.fetchAniZip).toHaveBeenCalledTimes(1)
  })
})

describe('primeTitleExtras', () => {
  it('warms the schedule for a list in one batch when audio is bound', () => {
    primeTitleExtras([media(), media({ id: 21 })], all)
    expect(mocks.getScheduleInfoMany).toHaveBeenCalledWith([
      { id: 154587, titles: ['Sousou no Frieren', 'Frieren'] },
      { id: 21, titles: ['Sousou no Frieren', 'Frieren'] },
    ])
    mocks.getScheduleInfoMany.mockClear()
    primeTitleExtras([media()], new Set(['keyart']))
    expect(mocks.getScheduleInfoMany).not.toHaveBeenCalled()
  })
  it('holds a primed title\'s own schedule lookup until the batch has answered', async () => {
    let answer: (value: Map<number, unknown>) => void = () => {}
    mocks.getScheduleInfoMany.mockReturnValue(new Promise((resolve) => { answer = resolve }))
    primeTitleExtras([media(), media({ id: 21 })], all)
    const extras = loadTitleExtras(media(), new Set(['audio']))
    await settle()
    expect(mocks.getScheduleInfo).not.toHaveBeenCalled()
    answer(new Map())
    await expect(extras).resolves.toEqual({ audio: 'Sub | Dub' })
    expect(mocks.getScheduleInfo).toHaveBeenCalledTimes(1)
  })
  it('still looks a title up when the batch fails', async () => {
    mocks.getScheduleInfoMany.mockRejectedValue(new Error('429'))
    primeTitleExtras([media()], all)
    await expect(loadTitleExtras(media(), new Set(['audio']))).resolves.toEqual({ audio: 'Sub | Dub' })
  })
})

describe('peekTitleArt', () => {
  it('reads artwork a finished lookup found, without waiting', async () => {
    expect(peekTitleArt(154587)).toBeUndefined()
    const pending = loadTitleExtras(media(), new Set(['keyart', 'logo'] as const))
    // Still in flight: nothing to read yet.
    expect(peekTitleArt(154587)).toBeUndefined()
    await pending
    expect(peekTitleArt(154587)).toEqual({ keyart: FANART, logo: LOGO })
    expect(peekTitleArt(undefined)).toBeUndefined()
  })
  it('keeps nothing for a lookup that found no artwork, so it is asked again', async () => {
    mocks.fetchAniZip.mockResolvedValue({ images: [] })
    await loadTitleExtras(media({ id: 21 }), new Set(['keyart'] as const))
    expect(peekTitleArt(21)).toBeUndefined()
  })
})

describe('titleExtrasKey', () => {
  it('changes only when the record brings something the lookups read', () => {
    const card = media({ coverImage: { extraLarge: 'a.jpg' }, genres: ['Drama'] } as Partial<Media>)
    // The full record repeats the card's inputs and adds fields the lookups never read.
    const full = media({ coverImage: { extraLarge: 'a.jpg' }, genres: ['Drama'], description: 'text', popularity: 9 } as Partial<Media>)
    expect(titleExtrasKey(full)).toBe(titleExtrasKey(card))
    // A provider logo, a MyAnimeList id or a certification is new input.
    expect(titleExtrasKey(media({ logoImage: 'logo.png' }))).not.toBe(titleExtrasKey(card))
    expect(titleExtrasKey(media({ idMal: 1 }))).not.toBe(titleExtrasKey(card))
    expect(titleExtrasKey(media({ contentRating: 'TV-14' }))).not.toBe(titleExtrasKey(card))
    // A placeholder that knows only the id gains the titles the schedule lookup matches on.
    expect(titleExtrasKey({ id: 154587, title: {} } as Media)).not.toBe(titleExtrasKey(card))
  })
  it('reads a TMDB or add-on banner as key art input, and no other banner', () => {
    const tmdb = (bannerImage: string) => media({ bannerImage, catalog: { provider: 'tmdb', type: 'anime', id: '1' } } as Partial<Media>)
    expect(titleExtrasKey(tmdb('a.jpg'))).not.toBe(titleExtrasKey(tmdb('b.jpg')))
    expect(titleExtrasKey(media({ bannerImage: 'a.jpg' }))).toBe(titleExtrasKey(media({ bannerImage: 'b.jpg' })))
  })
})
