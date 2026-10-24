import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Media } from '$lib/anilist/types'

const mocks = vi.hoisted(() => ({
  fetchAniZip: vi.fn(),
  fetchMalRating: vi.fn(),
  getScheduleInfo: vi.fn(),
  getScheduleInfoMany: vi.fn(),
  tmdb: vi.fn(),
  fetch: vi.fn(),
  locale: 'en',
}))
vi.mock('$lib/trakt/config', async () => ({ traktAppClientId: '', traktClientId: (await import('svelte/store')).writable('') }))
vi.mock('$lib/anizip', () => ({ fetchAniZip: mocks.fetchAniZip }))
vi.mock('$lib/anilist/jikan', () => ({ fetchMalRating: mocks.fetchMalRating }))
vi.mock('$lib/catalog/providers/tmdb', () => ({ tmdb: mocks.tmdb }))
vi.mock('$lib/paraglide/runtime.js', () => ({ getLocale: () => mocks.locale }))
vi.mock('$lib/anime/animeschedule', () => ({
  getScheduleInfo: mocks.getScheduleInfo,
  getScheduleInfoMany: mocks.getScheduleInfoMany,
  scheduleTitles: (t: { romaji?: string; english?: string }) => [t.romaji, t.english],
}))

import { ART_EXTRAS, artNeeds, audioLabel, clearTitleExtrasCache, languageCode, loadTitleExtras, logoLanguages, malAgeRating, metaNeeds, nativeLanguage, peekTitleArt, pickTitleArt, pickTitleLogo, primeTitleExtras, queueTitleArt, templateNeeds, titleExtrasKey, type TitleExtras } from './title-extras'
import { tmdbReadToken } from '$lib/settings/catalog'
import { traktClientId } from '$lib/trakt/config'
import type { ThemeNode } from './presentation'

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
// A stubbed `fetch` answer.
const answer = (body: unknown, status = 200) => async () => ({ ok: status < 400, status, json: async () => body })

const FANART = 'https://artworks.thetvdb.com/banners/v4/series/424536/backgrounds/64e6cbe29d9c0.jpg'
const LOGO = 'https://artworks.thetvdb.com/banners/v4/series/424536/clearlogo/696a802a5aa22.png'
const POSTER = 'https://artworks.thetvdb.com/banners/v4/series/424536/posters/64e6cb7b4d5ba.jpg'
const media = (extra: Partial<Media> = {}): Media => ({ id: 154587, idMal: 52991, title: { romaji: 'Sousou no Frieren', english: 'Frieren' }, ...extra }) as Media
const all = new Set(['keyart', 'logo', 'ageRating', 'audio'] as const)

beforeEach(() => {
  clearTitleExtrasCache()
  for (const mock of [mocks.fetchAniZip, mocks.fetchMalRating, mocks.getScheduleInfo, mocks.getScheduleInfoMany, mocks.tmdb, mocks.fetch]) mock.mockReset()
  mocks.locale = 'en'
  tmdbReadToken.set('')
  traktClientId.set('trakt-id')
  mocks.fetch.mockImplementation(answer([]))
  vi.stubGlobal('fetch', mocks.fetch)
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

describe('an English title logo from Trakt', () => {
  const TRAKT_LOGO = 'media.trakt.tv/images/shows/000/173/241/logos/medium/066bcd9b77.png.webp'
  const TRAKT_FULL = 'https://media.trakt.tv/images/shows/000/173/241/logos/full/066bcd9b77.png.webp'
  const mappings = { thetvdb_id: 397934, themoviedb_id: '114410', imdb_id: 'tt13616990' }
  const logoOnly = new Set(['logo'] as const)
  beforeEach(() => {
    mocks.fetchAniZip.mockResolvedValue({ images: [{ coverType: 'Fanart', url: FANART }, { coverType: 'Clearlogo', url: LOGO }], mappings })
    mocks.fetch.mockImplementation(answer([{ type: 'show', show: { images: { logo: [TRAKT_LOGO] } } }]))
  })
  it('replaces the untagged TVDB logo when TMDB is not set up, at full size', async () => {
    await expect(loadTitleExtras(media(), logoOnly)).resolves.toEqual({ logo: TRAKT_FULL })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = mocks.fetch.mock.calls[0]
    expect(url).toBe('https://api.trakt.tv/search/tvdb/397934?type=show&extended=images')
    expect(init.headers).toMatchObject({ 'trakt-api-version': '2', 'trakt-api-key': 'trakt-id' })
    expect(peekTitleArt(154587)).toMatchObject({ keyart: FANART, logo: TRAKT_FULL })
  })
  it('looks a film up by its TMDB id, and keeps a URL that already names its scheme', async () => {
    mocks.fetch.mockImplementation(answer([{ type: 'movie', movie: { images: { logo: ['https://media.trakt.tv/images/movies/000/001/logos/medium/a.png.webp'] } } }]))
    await expect(loadTitleExtras(media({ format: 'MOVIE' }), logoOnly)).resolves.toEqual({ logo: 'https://media.trakt.tv/images/movies/000/001/logos/full/a.png.webp' })
    expect(mocks.fetch.mock.calls[0][0]).toBe('https://api.trakt.tv/search/tmdb/114410?type=movie&extended=images')
  })
  it('comes after an English TMDB logo, and before the TVDB one when TMDB has none', async () => {
    tmdbReadToken.set('token')
    mocks.tmdb.mockResolvedValue({ logos: [{ file_path: '/en.png', iso_639_1: 'en' }] })
    await expect(loadTitleExtras(media(), logoOnly)).resolves.toEqual({ logo: 'https://image.tmdb.org/t/p/w500/en.png' })
    expect(mocks.fetch).not.toHaveBeenCalled()
    clearTitleExtrasCache()
    mocks.tmdb.mockResolvedValue({ logos: [] })
    await expect(loadTitleExtras(media(), logoOnly)).resolves.toEqual({ logo: TRAKT_FULL })
  })
  it('is not asked when the TVDB logo is tagged English', async () => {
    mocks.fetchAniZip.mockResolvedValue({ images: [{ coverType: 'Clearlogo', url: LOGO, language: 'eng' }], mappings })
    await expect(loadTitleExtras(media(), logoOnly)).resolves.toEqual({ logo: LOGO })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('is never asked without a client id', async () => {
    traktClientId.set('')
    await expect(loadTitleExtras(media(), logoOnly)).resolves.toEqual({ logo: LOGO })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it("keeps the title's own logo for an app in the title's language", async () => {
    mocks.locale = 'ja'
    await expect(loadTitleExtras(media(), logoOnly)).resolves.toEqual({ logo: LOGO })
    expect(mocks.fetch).not.toHaveBeenCalled()
    // A Korean title has no own-language claim on a Japanese app: English still beats it.
    await expect(loadTitleExtras(media({ id: 7, countryOfOrigin: 'KR' }), logoOnly)).resolves.toEqual({ logo: TRAKT_FULL })
  })
  it('falls back to the TVDB logo when the request fails, and asks again next time', async () => {
    mocks.fetch.mockImplementationOnce(answer({ error: 'rate limited' }, 429))
    await expect(loadTitleExtras(media(), logoOnly)).resolves.toEqual({ logo: LOGO })
    await expect(loadTitleExtras(media(), logoOnly)).resolves.toEqual({ logo: TRAKT_FULL })
    await loadTitleExtras(media(), logoOnly)
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    clearTitleExtrasCache()
    mocks.fetch.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'))
    await expect(loadTitleExtras(media(), logoOnly)).resolves.toEqual({ logo: LOGO })
  })
  it('keeps the TVDB logo when Trakt has none, without asking again', async () => {
    mocks.fetch.mockImplementation(answer([]))
    await expect(loadTitleExtras(media(), logoOnly)).resolves.toEqual({ logo: LOGO })
    await expect(loadTitleExtras(media(), logoOnly)).resolves.toEqual({ logo: LOGO })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
})

describe('series artwork on a later season or a film', () => {
  // ani.zip copies the TVDB series' artwork into every title it maps to that series.
  const series = { images: [{ coverType: 'Fanart', url: FANART }, { coverType: 'Clearlogo', url: LOGO }, { coverType: 'Poster', url: POSTER }], mappings: { thetvdb_id: 377543, themoviedb_id: 95479, imdb_id: 'tt12343534', type: 'TV' } }
  const startsAt = (seasonNumber: number, episodeNumber: number) => ({ '1': { seasonNumber, episodeNumber } })
  const art = new Set(['keyart', 'logo', 'posterHd'] as const)
  it('stays on the title that starts the series', async () => {
    mocks.fetchAniZip.mockResolvedValue({ ...series, episodes: startsAt(1, 1) })
    await expect(loadTitleExtras(media(), art)).resolves.toEqual({ keyart: FANART, logo: LOGO, posterHd: POSTER })
  })
  it('is left off a later season or a later cour, and no show-wide logo is asked for', async () => {
    tmdbReadToken.set('token')
    for (const [season, episode] of [[2, 1], [1, 13]]) {
      clearTitleExtrasCache()
      mocks.fetchAniZip.mockResolvedValue({ ...series, episodes: startsAt(season, episode) })
      await expect(loadTitleExtras(media(), art)).resolves.toEqual({})
    }
    expect(mocks.tmdb).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
    // The record answered: it is not asked for again.
    await loadTitleExtras(media(), art)
    expect(mocks.fetchAniZip).toHaveBeenCalledTimes(2)
  })
  it("is left off a film filed under the series' specials, which keeps its own logo", async () => {
    mocks.fetchAniZip.mockResolvedValue({ ...series, mappings: { ...series.mappings, themoviedb_id: 810693, type: 'MOVIE' }, episodes: startsAt(0, 1) })
    mocks.fetch.mockImplementation(answer([{ type: 'movie', movie: { images: { logo: ['media.trakt.tv/images/movies/1/logos/medium/zero.png.webp'] } } }]))
    await expect(loadTitleExtras(media({ format: 'MOVIE' }), art)).resolves.toEqual({ logo: 'https://media.trakt.tv/images/movies/1/logos/full/zero.png.webp' })
    expect(mocks.fetch.mock.calls[0][0]).toBe('https://api.trakt.tv/search/tmdb/810693?type=movie&extended=images')
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

describe('queueTitleArt', () => {
  const keyart = new Set<'keyart'>(['keyart'])
  // A lookup that stays open until released, so a test decides when each slot frees.
  function lookups() {
    let running = 0
    let peak = 0
    const started: number[] = []
    const releases = new Map<number, () => void>()
    const load = (m: Media) => new Promise<TitleExtras>((resolve) => {
      const id = m.id as number
      running++; peak = Math.max(peak, running); started.push(id)
      releases.set(id, () => { running--; releases.delete(id); resolve({ keyart: `k${id}` }) })
    })
    const drain = async () => { while (releases.size) { releases.values().next().value!(); await settle() } }
    return { load, started, releases, drain, running: () => running, peak: () => peak }
  }
  const call = (id: number, options: Parameters<typeof queueTitleArt>[2]) => queueTitleArt({ id } as Media, keyart, options)

  it('runs at most four lookups at once and hands each freed slot to the next caller', async () => {
    const { load, releases, drain, running, peak } = lookups()
    const results = Array.from({ length: 7 }, (_, i) => call(i, { load }))
    await settle()
    expect(running()).toBe(4)
    // Free one slot, and start a fresh call in the same tick: the freed slot goes to a waiter, never over 4.
    releases.get(0)!()
    const late = call(99, { load })
    await settle()
    expect(running()).toBe(4)
    expect(peak()).toBe(4)
    await drain()
    expect((await Promise.all([...results, late])).map((r) => r.keyart)).toEqual(['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k99'])
  })

  it('serves waiters in the order they queued when none says how far it is', async () => {
    const { load, releases, started, drain } = lookups()
    const all = [0, 1, 2, 3, 4, 5, 6].map((id) => call(id, { load }))
    await settle()
    for (const id of [0, 1, 2]) { releases.get(id)!(); await settle() }
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6])
    await drain()
    await Promise.all(all)
  })

  it('hands a freed slot to the nearest waiter, judged when the slot frees', async () => {
    const { load, releases, started, drain } = lookups()
    const far: Record<number, number> = { 4: 900, 5: 600, 6: 300 }
    const all = [0, 1, 2, 3].map((id) => call(id, { load }))
    all.push(...[4, 5, 6].map((id) => call(id, { load, distance: () => far[id] })))
    await settle()
    expect(started).toEqual([0, 1, 2, 3])
    // 4 was the farthest when it queued; by the time a slot frees it is the second nearest.
    far[4] = 450
    for (const id of [0, 1, 2]) { releases.get(id)!(); await settle() }
    expect(started.slice(4)).toEqual([6, 4, 5])
    await drain()
    await Promise.all(all)
  })

  it('keeps first come first served between waiters at the same distance', async () => {
    const { load, releases, started, drain } = lookups()
    const all = [0, 1, 2, 3].map((id) => call(id, { load }))
    all.push(...[4, 5, 6, 7].map((id) => call(id, { load, distance: () => (id === 7 ? 10 : 50) })))
    await settle()
    for (const id of [0, 1, 2]) { releases.get(id)!(); await settle() }
    expect(started.slice(4)).toEqual([7, 4, 5])
    await drain()
    await Promise.all(all)
  })

  it('skips callers that are gone without a lookup and without taking a slot', async () => {
    const { load, releases, started, drain, running } = lookups()
    const gone = new Set<number>()
    const all = [0, 1, 2, 3].map((id) => call(id, { load }))
    const dead = [4, 5].map((id) => call(id, { load, alive: () => !gone.has(id), distance: () => 0 }))
    const live = call(6, { load, distance: () => 800 })
    // They were alive when queued and are gone by the time a slot frees.
    await settle()
    gone.add(4); gone.add(5)
    releases.get(0)!(); await settle()
    // The two dead waiters are nearer but never load; the live one takes the slot.
    expect(started).toEqual([0, 1, 2, 3, 6])
    expect(running()).toBe(4)
    expect(await Promise.all(dead)).toEqual([{}, {}])
    // A caller that is already gone does not load even when a slot is free.
    for (const id of [1, 2, 3, 6]) { releases.get(id)!(); await settle() }
    expect(running()).toBe(0)
    expect(await call(7, { load, alive: () => false })).toEqual({})
    expect(started).toEqual([0, 1, 2, 3, 6])
    // Every slot is still there to use.
    const next = Array.from({ length: 5 }, (_, i) => call(10 + i, { load }))
    await settle()
    expect(running()).toBe(4)
    await drain()
    await Promise.all([...all, live, ...next])
  })

  it('serves a waiter whose distance throws after the others, with the slot count intact', async () => {
    const { load, releases, started, drain, running, peak } = lookups()
    const all = [0, 1, 2, 3].map((id) => call(id, { load }))
    all.push(call(4, { load, distance: () => { throw new Error('detached') } }))
    all.push(...[5, 6].map((id) => call(id, { load, distance: () => id * 100 })))
    await settle()
    for (const id of [0, 1, 2]) { releases.get(id)!(); await settle() }
    expect(started.slice(4)).toEqual([5, 6, 4])
    expect(running()).toBe(4)
    await drain()
    await Promise.all(all)
    expect(running()).toBe(0)
    const next = Array.from({ length: 5 }, (_, i) => call(10 + i, { load }))
    await settle()
    expect(running()).toBe(4)
    expect(peak()).toBe(4)
    await drain()
    await Promise.all(next)
  })

  it('drops a waiter whose alive check throws without a lookup and without leaking the slot', async () => {
    const { load, releases, started, drain, running } = lookups()
    let broken = false
    const all = [0, 1, 2, 3].map((id) => call(id, { load }))
    const bad = call(4, { load, alive: () => { if (broken) throw new Error('detached'); return true } })
    await settle()
    broken = true
    for (const id of [0, 1, 2, 3]) { releases.get(id)!(); await settle() }
    expect(await bad).toEqual({})
    expect(started).toEqual([0, 1, 2, 3])
    expect(running()).toBe(0)
    // A check that throws up front is gone too.
    expect(await call(5, { load, alive: () => { throw new Error('detached') } })).toEqual({})
    const next = Array.from({ length: 5 }, (_, i) => call(10 + i, { load }))
    await settle()
    expect(running()).toBe(4)
    await drain()
    await Promise.all([...all, ...next])
  })

  it('frees its slot when a lookup fails', async () => {
    const failing = () => Promise.reject(new Error('offline'))
    await expect(call(1, { load: failing })).rejects.toThrow('offline')
    const ok = await call(2, { load: async () => ({ logo: 'l' }) })
    expect(ok.logo).toBe('l')
  })

  it('hands the slot on when the lookup a waiter was queued behind fails', async () => {
    const { load, started, drain } = lookups()
    const failing = () => new Promise<TitleExtras>((_, reject) => setTimeout(() => reject(new Error('offline')), 5))
    const held = [0, 1, 2].map((id) => call(id, { load }))
    const bad = call(3, { load: failing })
    const waiter = call(4, { load })
    await expect(bad).rejects.toThrow('offline')
    await settle()
    expect(started).toEqual([0, 1, 2, 4])
    await drain()
    await Promise.all([...held, waiter])
  })
})
