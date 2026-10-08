import { describe, expect, it } from 'vitest'
import type { Media } from '$lib/anilist/types'
import { creatorsText, durationLongText, episodeDisplayModel, mediaDisplayModel, seriesRatingText, starringText, timeLeftLabel } from './host-model'
import { displayText } from './presentation'

const media = {
  id: 1,
  title: { userPreferred: 'Sakura', romaji: 'Sakura', english: 'Sakura' },
  description: '<i>A story.</i>',
  averageScore: 78,
  format: 'TV',
  season: 'WINTER',
  seasonYear: 2021,
  status: 'RELEASING',
  duration: 24,
  episodes: 12,
  popularity: 15000,
  genres: ['Drama', 'Fantasy'],
  studios: { nodes: [{ id: 9, name: 'White Fox' }] },
  coverImage: { extraLarge: 'https://example.test/poster.jpg', medium: 'https://example.test/poster-m.jpg' },
  bannerImage: 'https://example.test/banner.jpg',
  startDate: { year: 2021 },
} as Media

describe('theme host display model', () => {
  it('binds the first genre on its own beside the joined list', () => {
    expect(mediaDisplayModel(media).genre).toBe('Drama')
    expect(mediaDisplayModel(media).genres).toBe('Drama · Fantasy')
    expect(mediaDisplayModel({ ...media, genres: [] }).genre).toBeUndefined()
  })
  it('exposes series fields as the shared contract types', () => {
    const model = mediaDisplayModel(media)
    expect(model.title).toBe('Sakura')
    expect(model.description).toBe('A story.')
    expect(model.score).toBe(78)
    expect(model.studio).toBe('White Fox')
    expect(model.genres).toContain('Drama')
    expect(model.episodeCount).toBe('12')
    expect(model.duration).toBe(24)
    expect(displayText('score', model)).toBe('78%')
    expect(displayText('duration', model)).toBe('24m')
    expect(model.source).toBeUndefined()
    expect(model.country).toBeUndefined()
  })
  it('strips complete markup and leftover angle brackets from descriptions', () => {
    expect(mediaDisplayModel({ ...media, description: '<i>A story.</i>' }).description).toBe('A story.')
    expect(mediaDisplayModel({ ...media, description: '<script alert' }).description).toBe('script alert')
    expect(mediaDisplayModel({ ...media, description: '<scr<script>ipt>' }).description).toBe('ipt')
  })
  it('adds episode stills, titles and progress without stringifying numbers', () => {
    const model = episodeDisplayModel(media, 8, {
      title: 'From Zero',
      overview: 'The next step.',
      image: 'https://example.test/still.jpg',
      runtime: 24,
      airDate: '2021-03-01',
    }, { progress: 42, score: 91 })
    expect(model.episodeNumber).toBe(8)
    expect(model.episodeTitle).toBe('From Zero')
    expect(model.still).toContain('still.jpg')
    expect(model.progress).toBe(42)
    expect(model.score).toBe(91)
    expect(displayText('progress', model)).toBe('42%')
  })
  it('exposes source and country labels for series-facts templates', () => {
    const model = mediaDisplayModel({ ...media, source: 'MANGA', countryOfOrigin: 'JP' })
    expect(model.source).toBe('manga')
    expect(model.country).toBe('Japan')
  })
  it('binds the next episode, both countdowns and the aired count', () => {
    const now = Date.UTC(2026, 0, 1)
    const airing = { ...media, nextAiringEpisode: { episode: 5, airingAt: now / 1000 + 2 * 86400 + 3 * 3600 + 60, timeUntilAiring: 0 } } as Media
    const model = mediaDisplayModel(airing, {}, 0, now)
    expect(model.nextEpisode).toBe(5)
    expect(model.airingIn).toBe('2d 3h')
    expect(model.airingCountdown).toBe('2 days 3 hrs 1 min')
    expect(model.episodesAired).toBe(4)
  })
  it('falls back to the provider aired count and finished totals', () => {
    expect(mediaDisplayModel({ ...media, airedEpisodes: 7 } as Media).episodesAired).toBe(7)
    expect(mediaDisplayModel({ ...media, status: 'FINISHED', episodes: 12 } as Media).episodesAired).toBe(12)
    expect(mediaDisplayModel(media).airingIn).toBeUndefined()
    expect(mediaDisplayModel(media).episodesAired).toBeUndefined()
    expect(mediaDisplayModel({ ...media, airedEpisodes: 0 } as Media).episodesAired).toBe(0)
    expect(mediaDisplayModel({ ...media, nextAiringEpisode: { episode: 1, timeUntilAiring: 3600 } } as Media).episodesAired).toBe(0)
  })
  it('uses the relative countdown when the absolute airing time is missing', () => {
    const model = mediaDisplayModel({ ...media, nextAiringEpisode: { episode: 3, timeUntilAiring: 90 * 60 } } as Media)
    expect(model.airingIn).toBe('1h 30m')
    expect(model.airingCountdown).toBe('1 hr 30 mins')
  })
})

describe('API 4 title fields in the host model', () => {
  it('binds the score out of ten on a title, and nothing for an unscored one', () => {
    expect(mediaDisplayModel({ ...media, averageScore: 86 }).rating).toBe('8.6')
    expect(mediaDisplayModel({ ...media, averageScore: 80 }).rating).toBe('8.0')
    expect(mediaDisplayModel({ ...media, averageScore: 0 }).rating).toBeUndefined()
    expect(mediaDisplayModel({ ...media, averageScore: undefined }).rating).toBeUndefined()
    expect(seriesRatingText({ averageScore: 86 })).toBe('8.6')
  })
  it('never lends the series score to an episode: an unrated or unaired episode has no rating', () => {
    const scored = { ...media, averageScore: 86 }
    expect(episodeDisplayModel(scored, 13, { title: 'Not Yet' }).rating).toBeUndefined()
    expect(episodeDisplayModel(scored, 13, undefined, { rating: undefined }).rating).toBeUndefined()
    expect(episodeDisplayModel(scored, 4, undefined, { rating: '7.9' }).rating).toBe('7.9')
    // The series score itself stays bound, as before.
    expect(episodeDisplayModel(scored, 13).score).toBe(86)
  })
  it('binds the release year apart from the season', () => {
    const fall = { ...media, season: 'FALL', seasonYear: 2023, startDate: { year: 2023 } } as Media
    expect(mediaDisplayModel(fall).startYear).toBe('2023')
    expect(mediaDisplayModel(fall).year).toBe('Fall 2023')
    expect(mediaDisplayModel({ ...media, season: undefined, seasonYear: undefined, startDate: { year: 1998 } } as Media).startYear).toBe('1998')
    expect(mediaDisplayModel({ ...media, season: undefined, seasonYear: undefined, startDate: null } as Media).startYear).toBeUndefined()
  })
  it('binds the second and third genres on their own', () => {
    const model = mediaDisplayModel({ ...media, genres: ['Action', 'Drama', 'Fantasy', 'Mystery'] })
    expect([model.genre, model.genre2, model.genre3]).toEqual(['Action', 'Drama', 'Fantasy'])
    expect(mediaDisplayModel({ ...media, genres: ['Action'] }).genre2).toBeUndefined()
    expect(mediaDisplayModel({ ...media, genres: ['Action', 'Drama'] }).genre3).toBeUndefined()
  })
  it('prints the episodes watched a host passes as a bare number', () => {
    const model = mediaDisplayModel(media, { episodesWatched: 4 })
    expect(model.episodesWatched).toBe(4)
    expect(displayText('episodesWatched', model)).toBe('4')
    expect(displayText('episodesWatched', mediaDisplayModel(media, { episodesWatched: 0 }))).toBe('0')
    expect(mediaDisplayModel(media).episodesWatched).toBeUndefined()
  })
})

describe('timeLeftLabel', () => {
  it('formats the time left in a started episode', () => {
    expect(timeLeftLabel({ pos: 180, dur: 1440 })).toBe('21m left')
    expect(timeLeftLabel({ pos: 1430, dur: 1440 })).toBe('1m left')
    expect(timeLeftLabel({ pos: 0, dur: 1440 })).toBeUndefined()
    expect(timeLeftLabel({ pos: 100, dur: 0 })).toBeUndefined()
    expect(timeLeftLabel({ pos: 100, dur: 1440, cleared: true })).toBeUndefined()
    expect(timeLeftLabel(undefined)).toBeUndefined()
  })
})

describe('the episode name in the host model', () => {
  it('binds a real title and leaves the field out otherwise', () => {
    expect(episodeDisplayModel(media, 8, { title: 'From Zero' }).episodeName).toBe('From Zero')
    expect(episodeDisplayModel(media, 8).episodeName).toBeUndefined()
    expect(episodeDisplayModel(media, 8, { title: 'Episode 8' }).episodeName).toBeUndefined()
  })
  it("follows the host's own title: a provider title counts, an Episode N stand-in does not", () => {
    expect(episodeDisplayModel(media, 8, undefined, { episodeTitle: 'From Zero' }).episodeName).toBe('From Zero')
    expect(episodeDisplayModel(media, 8, { title: 'From Zero' }, { episodeTitle: 'Episode 8' }).episodeName).toBeUndefined()
  })
  it('leaves it out when the host hides the title, while episodeTitle keeps the host label', () => {
    const model = episodeDisplayModel(media, 8, { title: 'From Zero' }, { episodeTitle: 'Episode 8', episodeName: undefined })
    expect(model.episodeName).toBeUndefined()
    expect(model.episodeTitle).toBe('Episode 8')
  })
})

describe('episode template fields in the host model', () => {
  it('binds the plain number and the season code from episode metadata', () => {
    const model = episodeDisplayModel(media, 5, { season: 2 })
    expect(model.episodeNo).toBe('5')
    expect(model.episodeCode).toBe('S2 E5')
    expect(model.episodeNumber).toBe(5)
    expect(displayText('episodeNumber', model)).toBe('E5')
    expect(episodeDisplayModel(media, 1, { season: 4, seasonEpisode: 17 }).episodeCode).toBe('S4 E17')
    expect(episodeDisplayModel(media, 5).episodeCode).toBe('E5')
    expect(episodeDisplayModel(media, 5, undefined, { episodeNo: '1071', watched: 'Watched', filler: 'Filler', rating: '8.5' }))
      .toMatchObject({ episodeNo: '1071', watched: 'Watched', filler: 'Filler', rating: '8.5' })
  })
})

describe('API 4 fields added for phone replicas', () => {
  it('writes the running time out in words', () => {
    expect(durationLongText(24)).toBe('24 mins')
    expect(durationLongText(1)).toBe('1 min')
    expect(durationLongText(60)).toBe('1 hr')
    expect(durationLongText(105)).toBe('1 hr 45 mins')
    expect(durationLongText(121)).toBe('2 hrs 1 min')
    expect(durationLongText(120)).toBe('2 hrs')
    expect(durationLongText(23.6)).toBe('24 mins')
    for (const none of [0, -5, null, undefined, Number.NaN]) expect(durationLongText(none), String(none)).toBeUndefined()
    expect(mediaDisplayModel(media).durationLong).toBe('24 mins')
    expect(mediaDisplayModel({ ...media, duration: undefined }).durationLong).toBeUndefined()
    // An episode's own runtime wins over the series average.
    expect(episodeDisplayModel(media, 3, { runtime: 47 }).durationLong).toBe('47 mins')
  })

  it('binds the bare score beside the percentage', () => {
    const model = mediaDisplayModel(media)
    expect(model.scoreValue).toBe('78')
    expect(displayText('scoreValue', model)).toBe('78')
    expect(displayText('score', model)).toBe('78%')
    expect(mediaDisplayModel({ ...media, averageScore: undefined }).scoreValue).toBeUndefined()
    expect(mediaDisplayModel(media, { score: 91 }).scoreValue).toBe('91')
  })

  it('reports a due episode once its countdown has run out and no newer one is known', () => {
    const now = Date.UTC(2026, 0, 10, 12)
    const at = (offset: number) => ({ ...media, nextAiringEpisode: { episode: 13, airingAt: now / 1000 + offset, timeUntilAiring: offset } }) as Media
    const due = mediaDisplayModel(at(-600), {}, 0, now)
    expect(due).toMatchObject({ airingSoon: 'Soon', nextEpisode: 13 })
    expect(due.airingIn).toBeUndefined()
    const ahead = mediaDisplayModel(at(3600), {}, 0, now)
    expect(ahead.airingSoon).toBeUndefined()
    expect(ahead.airingIn).toBe('1h 0m')
    expect(mediaDisplayModel(media, {}, 0, now).airingSoon).toBeUndefined()
  })

  it('binds the full-resolution poster: a looked-up one, else the largest catalog cover', () => {
    expect(mediaDisplayModel(media).posterHd).toBe('https://example.test/poster.jpg')
    // A card passes its card-sized cover as `poster`; the full-resolution one stays the largest.
    expect(mediaDisplayModel(media, { poster: 'https://example.test/poster-small.jpg' }).posterHd).toBe('https://example.test/poster.jpg')
    expect(mediaDisplayModel(media, { posterHd: 'https://artworks.example.test/poster.jpg' }).posterHd).toBe('https://artworks.example.test/poster.jpg')
  })

  it('passes the finished mark a host computes', () => {
    expect(mediaDisplayModel(media).completed).toBeUndefined()
    expect(mediaDisplayModel(media, { completed: 'Completed' }).completed).toBe('Completed')
  })
})

describe('credit lines in the host model', () => {
  const character = (id: number, full?: string) => ({ role: 'MAIN', node: { id, name: { full } } })
  it('names the first three characters for a starring line', () => {
    const cast = { ...media, characters: { edges: [character(1, 'Frieren'), character(2, 'Fern'), character(3, ' Stark '), character(4, 'Himmel')] } } as Media
    expect(mediaDisplayModel(cast).starring).toBe('Frieren, Fern, Stark')
    expect(starringText({ characters: { edges: [character(1), character(2, 'Fern')] } })).toBe('Fern')
    expect(mediaDisplayModel(media).starring).toBeUndefined()
    expect(starringText({ characters: { edges: [] } })).toBeUndefined()
  })
  it('joins every studio, else the provider creators', () => {
    expect(mediaDisplayModel(media).creators).toBe('White Fox')
    expect(creatorsText({ studios: { nodes: [{ name: 'MADHOUSE' }, { name: 'Studio X' }] } })).toBe('MADHOUSE, Studio X')
    expect(creatorsText({ studios: { nodes: [] }, creators: ['Someone'] })).toBe('Someone')
    expect(creatorsText({})).toBeUndefined()
  })
})
