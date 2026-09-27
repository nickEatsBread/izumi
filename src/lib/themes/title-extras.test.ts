import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Media } from '$lib/anilist/types'

const mocks = vi.hoisted(() => ({
  fetchAniZip: vi.fn(),
  fetchMalRating: vi.fn(),
  getScheduleInfo: vi.fn(),
  getScheduleInfoMany: vi.fn(),
}))
vi.mock('$lib/anizip', () => ({ fetchAniZip: mocks.fetchAniZip }))
vi.mock('$lib/anilist/jikan', () => ({ fetchMalRating: mocks.fetchMalRating }))
vi.mock('$lib/anime/animeschedule', () => ({
  getScheduleInfo: mocks.getScheduleInfo,
  getScheduleInfoMany: mocks.getScheduleInfoMany,
  scheduleTitles: (t: { romaji?: string; english?: string }) => [t.romaji, t.english],
}))

import { audioLabel, clearTitleExtrasCache, loadTitleExtras, malAgeRating, pickTitleArt, primeTitleExtras, templateNeeds } from './title-extras'
import type { ThemeNode } from './presentation'

const FANART = 'https://artworks.thetvdb.com/banners/v4/series/424536/backgrounds/64e6cbe29d9c0.jpg'
const LOGO = 'https://artworks.thetvdb.com/banners/v4/series/424536/clearlogo/696a802a5aa22.png'
const media = (extra: Partial<Media> = {}): Media => ({ id: 154587, idMal: 52991, title: { romaji: 'Sousou no Frieren', english: 'Frieren' }, ...extra }) as Media
const all = new Set(['keyart', 'logo', 'ageRating', 'audio'] as const)

beforeEach(() => {
  clearTitleExtrasCache()
  for (const mock of Object.values(mocks)) mock.mockReset()
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
})
