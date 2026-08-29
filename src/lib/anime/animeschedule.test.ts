import { beforeEach, describe, it, expect, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), del: vi.fn(), phttp: vi.fn() }))

vi.mock('idb-keyval', () => ({ get: mocks.get, set: mocks.set, del: mocks.del }))
vi.mock('$lib/net/http', () => ({ phttp: mocks.phttp }))

import {
  activeDelay, anilistIdOf, delayLabel, delayLines, delayPlaceholder, getScheduleInfo, getScheduleInfoMany,
  getWeeklySchedule, isoWeek,
  mapAnimeScheduleMedia, mergeScheduleAirings, normalize, nextOccurrence, parseTime, parseTimetable,
  pickEntry, resolveRoute,
  scheduleTitles, slotLabel, slotLines, titleKey,
  type RawAnime,
} from './animeschedule'

const ZERO = '0001-01-01T00:00:00Z'

describe('weekly fallback mapping', () => {
  beforeEach(() => {
    mocks.get.mockReset().mockResolvedValue(undefined)
    mocks.set.mockReset().mockResolvedValue(undefined)
    mocks.phttp.mockReset()
  })

  it('uses the ISO week expected by the public timetable', () => {
    expect(isoWeek(new Date(2026, 7, 10, 0, 0, 0).getTime() / 1000)).toEqual({ year: 2026, week: 33 })
  })

  it('keeps AniList ids canonical when mapping schedule cards', () => {
    expect(mapAnimeScheduleMedia({
      route: 'backup-anime', title: 'Backup Anime', status: 'Ongoing', episodes: 12,
      names: { english: 'Backup Anime' },
      websites: { aniList: 'anilist.co/anime/1234/Backup-Anime', mal: 'myanimelist.net/anime/5678/Backup_Anime' },
      imageVersionRoute: 'anime/jpg/default/backup.jpg', stats: { averageScore: 81.6 },
    })).toMatchObject({ id: 1234, idMal: 5678, status: 'RELEASING', episodes: 12, averageScore: 82 })
  })

  it('reads only native broadcasts from the weekly timetable', () => {
    const html = `
      <div route="backup-anime" airedEpisode="7" class="timetable-column-show aired">
        <h2 class="show-title-bar">Backup Anime</h2>
        <time datetime="2026-08-11T15:30+01:00"></time><span airType="raw">JPN</span>
      </div>
      <div route="backup-anime" airedEpisode="7" class="timetable-column-show aired">
        <h2 class="show-title-bar">Backup Anime</h2>
        <time datetime="2026-08-11T17:00+01:00"></time><span airType="sub">SUB</span>
      </div>`
    const start = new Date('2026-08-10T00:00:00+01:00').getTime() / 1000
    const end = start + 7 * 86400
    expect(parseTimetable(html, start, end)).toEqual([{
      route: 'backup-anime', title: 'Backup Anime', episode: 7,
      airingAt: new Date('2026-08-11T15:30+01:00').getTime() / 1000,
    }])
  })

  it('decodes the timezone offset used by the live AnimeSchedule HTML', () => {
    const html = `<div route="backup-anime" airedEpisode="7" class="timetable-column-show aired">
      <h2 class="show-title-bar">Backup Anime</h2>
      <time datetime="2026-08-11T15:30&#43;01:00"></time><span airType="raw">JPN</span>
    </div>`
    const start = new Date('2026-08-10T00:00:00+01:00').getTime() / 1000
    expect(parseTimetable(html, start, start + 7 * 86400)).toMatchObject([{
      route: 'backup-anime', episode: 7,
      airingAt: new Date('2026-08-11T15:30+01:00').getTime() / 1000,
    }])
  })

  it('merges a missing delayed episode without duplicating one still in the main feed', () => {
    const media = { id: 171110 } as never
    const other = { id: 1 } as never
    const base = [{ airingAt: 20, episode: 20, media }, { airingAt: 10, episode: 1, media: other }]
    const delayed = [
      { airingAt: 5, episode: 20, media, delayPlaceholder: true },
      { airingAt: 15, episode: 21, media, delayPlaceholder: true },
    ]
    expect(mergeScheduleAirings(base, delayed)).toEqual([
      base[1], delayed[1], base[0],
    ])
  })

  it('renders AnimeSchedule results even when supplemental Kitsu pages are throttled', async () => {
    const start = new Date('2026-08-10T00:00:00+01:00').getTime() / 1000
    const html = `<div route="backup-anime" airedEpisode="7" class="timetable-column-show aired">
      <h2 class="show-title-bar">Backup Anime</h2>
      <time datetime="2026-08-11T15:30+01:00"></time><span airType="raw">JPN</span>
    </div>`
    const raw: RawAnime = {
      route: 'backup-anime', title: 'Backup Anime', status: 'Ongoing',
      websites: { aniList: 'anilist.co/anime/1234/Backup-Anime' },
    }
    mocks.phttp.mockImplementation(async (url: string) => {
      if (url.startsWith('https://animeschedule.net/?')) {
        return { ok: true, status: 200, text: async () => html, json: async () => ({}) }
      }
      if (url.includes('animeschedule.net/api/v3/anime?years=')) {
        return { ok: true, status: 200, text: async () => '', json: async () => ({ totalAmount: 1, anime: [raw] }) }
      }
      return { ok: false, status: 429, text: async () => 'throttled', json: async () => ({}) }
    })

    await expect(getWeeklySchedule(start, start + 7 * 86400)).resolves.toMatchObject([{
      episode: 7, media: { id: 1234 },
    }])
  })
})

// Shapes lifted from live `/api/v3/anime/{route}` responses.
const FRIEREN: RawAnime = {
  route: 'sousou-no-frieren',
  title: 'Sousou no Frieren',
  status: 'Finished',
  names: { romaji: 'Sousou no Frieren', english: "Frieren: Beyond Journey's End", native: '葬送のフリーレン' },
  websites: { aniList: 'anilist.co/anime/154587/Sousou-no-Frieren/' },
  delayedTimetable: 'On Break',
  delayedFrom: '2023-12-29T00:00:00Z',
  delayedUntil: '2024-01-05T00:00:00Z',
  subDelayedFrom: ZERO,
  subDelayedUntil: ZERO,
  dubDelayedTimetable: 'On Break',
  dubDelayedFrom: '2023-12-29T00:00:00Z',
  dubDelayedUntil: '2024-01-12T00:00:00Z',
  jpnTime: '2023-10-02T14:00:00Z',
  subTime: '2024-03-11T15:00:00Z',
  dubTime: '2024-03-20T19:30:00Z',
}

const ONE_PIECE: RawAnime = {
  route: 'one-piece',
  title: 'One Piece',
  status: 'Ongoing',
  names: { romaji: 'One Piece', english: 'One Piece' },
  websites: { aniList: 'anilist.co/anime/21/One-Piece' },
  delayedTimetable: 'Delayed',
  delayedFrom: '2026-07-05T00:00:00Z',
  delayedUntil: '2026-07-12T00:00:00Z',
  subDelayedFrom: ZERO,
  subDelayedUntil: ZERO,
  dubDelayedFrom: ZERO,
  dubDelayedUntil: ZERO,
  jpnTime: '2025-04-01T14:15:00Z',
  subTime: '2025-10-17T16:00:00Z',
  dubTime: '2026-02-18T20:00:00Z',
}

const DURING_DELAY = Date.parse('2026-07-08T00:00:00Z')
const AFTER_DELAY = Date.parse('2026-08-01T00:00:00Z')

describe('parseTime', () => {
  it('reads a real timestamp', () => expect(parseTime('2024-01-05T00:00:00Z')).toBe(Date.parse('2024-01-05T00:00:00Z')))
  it('reads current day-first API timestamps without swapping the day and month', () => {
    expect(parseTime('29/08/2026 00:00:00')).toBe(Date.parse('2026-08-29T00:00:00Z'))
    expect(parseTime('05/09/2026 00:00:00')).toBe(Date.parse('2026-09-05T00:00:00Z'))
  })
  it('rejects either zero-time sentinel that stands in for "unset"', () => {
    expect(parseTime(ZERO)).toBeNull()
    expect(parseTime('01/01/0001 00:00:00')).toBeNull()
  })
  it('is null for a missing or unparseable value', () => {
    expect(parseTime(undefined)).toBeNull()
    expect(parseTime('')).toBeNull()
    expect(parseTime('not a date')).toBeNull()
  })
})

describe('current delay payloads', () => {
  it('normalizes a day-first one-week slip from the live API shape', () => {
    const info = normalize({
      route: 'bookworm', status: 'Delayed', delayedTimetable: 'Delayed',
      delayedFrom: '29/08/2026 00:00:00', delayedUntil: '05/09/2026 00:00:00',
      subDelayedFrom: '01/01/0001 00:00:00', subDelayedUntil: '01/01/0001 00:00:00',
    }, Date.parse('2026-08-29T12:00:00Z'))
    expect(info?.delay).toEqual({
      kind: 'delayed',
      from: Date.parse('2026-08-29T00:00:00Z'),
      until: Date.parse('2026-09-05T00:00:00Z'),
    })
    expect(delayLines(info)).toEqual([`Delayed until ${new Date('2026-09-05T00:00:00Z').toLocaleDateString([], { month: 'short', day: 'numeric' })}`])
  })

  it('restores the moved next episode in the week where the delay began', () => {
    const media = { id: 171110, nextAiringEpisode: { episode: 20, airingAt: 1788600600, timeUntilAiring: 0 } } as never
    const info = normalize({
      route: 'bookworm', status: 'Delayed', delayedTimetable: 'Delayed',
      delayedFrom: '29/08/2026 00:00:00', delayedUntil: '05/09/2026 00:00:00',
    }, Date.parse('2026-08-29T12:00:00Z'))
    const start = Date.parse('2026-08-23T23:00:00Z') / 1000
    const end = start + 7 * 86400
    expect(delayPlaceholder(media, info, start, end)).toMatchObject({
      episode: 20, media: { id: 171110 }, delayPlaceholder: true,
      airingAt: Date.parse('2026-08-29T00:00:00Z') / 1000,
    })
    expect(delayPlaceholder(media, info, end, end + 7 * 86400)).toBeNull()
  })
})

describe('activeDelay', () => {
  it('reports a window that is still running', () => {
    expect(activeDelay('Delayed', ONE_PIECE.delayedFrom, ONE_PIECE.delayedUntil, DURING_DELAY, false))
      .toEqual({ kind: 'delayed', from: Date.parse('2026-07-05T00:00:00Z'), until: Date.parse('2026-07-12T00:00:00Z') })
  })
  it('drops a window that has already ended', () =>
    expect(activeDelay('Delayed', ONE_PIECE.delayedFrom, ONE_PIECE.delayedUntil, AFTER_DELAY, false)).toBeNull())
  it('drops every window on a finished show', () =>
    expect(activeDelay('On Break', FRIEREN.delayedFrom, FRIEREN.delayedUntil, Date.parse('2024-01-01T00:00:00Z'), true)).toBeNull())
  it('keeps an open-ended hiatus that has started but has no announced return', () =>
    expect(activeDelay('On Break', '2026-07-05T00:00:00Z', ZERO, DURING_DELAY, false))
      .toEqual({ kind: 'break', from: Date.parse('2026-07-05T00:00:00Z'), until: null }))
  it('ignores a window that has not started yet and has no end', () =>
    expect(activeDelay('Delayed', '2026-09-01T00:00:00Z', ZERO, DURING_DELAY, false)).toBeNull())
  it('is null when both dates are unset', () =>
    expect(activeDelay(undefined, ZERO, ZERO, DURING_DELAY, false)).toBeNull())
  it('treats "Cour Break" as a break, not a slip', () =>
    expect(activeDelay('Cour Break', '2026-07-05T00:00:00Z', '2026-07-12T00:00:00Z', DURING_DELAY, false)?.kind).toBe('break'))

  // A window is published before it starts, and the UI states it as a fact. Which of the two
  // shapes it is decides whether saying it early helps or lies.
  it('holds back a cour break announced weeks before it begins', () =>
    expect(activeDelay('Cour Break', '2026-07-20T00:00:00Z', '2026-10-05T00:00:00Z', DURING_DELAY, false)).toBeNull())
  it('reports that same break once it has actually started', () =>
    expect(activeDelay('Cour Break', '2026-07-20T00:00:00Z', '2026-10-05T00:00:00Z', Date.parse('2026-08-01T00:00:00Z'), false)?.kind)
      .toBe('break'))
  it('announces a one-week slip ahead of time, which is the only warning there is', () =>
    expect(activeDelay('Delayed', '2026-07-12T00:00:00Z', '2026-07-19T00:00:00Z', DURING_DELAY, false))
      .toEqual({ kind: 'delayed', from: Date.parse('2026-07-12T00:00:00Z'), until: Date.parse('2026-07-19T00:00:00Z') }))
  it('keeps reporting a window with no start date, having nothing to gate on', () =>
    expect(activeDelay('On Break', ZERO, '2026-10-05T00:00:00Z', DURING_DELAY, false)?.kind).toBe('break'))
})

describe('normalize', () => {
  it('marks an ongoing show delayed while the window is open', () => {
    const info = normalize(ONE_PIECE, DURING_DELAY)!
    expect(info.route).toBe('one-piece')
    expect(info.delay?.kind).toBe('delayed')
    expect(info.subDelay).toBeNull()
    expect(info.dubDelay).toBeNull()
    expect(info.finished).toBe(false)
  })
  it('clears a stale window once it has passed', () => {
    const info = normalize(ONE_PIECE, AFTER_DELAY)!
    expect(info.delay).toBeNull()
    expect(info.subAt).toBe(Date.parse('2025-10-17T16:00:00Z'))
  })
  it('never reports a finished show as on break, however old its stored window', () => {
    const info = normalize(FRIEREN, Date.parse('2024-01-01T00:00:00Z'))!
    expect(info.finished).toBe(true)
    expect([info.delay, info.subDelay, info.dubDelay]).toEqual([null, null, null])
  })
  it('carries a dub break through while the broadcast has already resumed', () => {
    const midDub = Date.parse('2024-01-08T00:00:00Z')
    const info = normalize({ ...FRIEREN, status: 'Ongoing' }, midDub)!
    expect(info.delay).toBeNull()
    expect(info.dubDelay).toEqual({ kind: 'break', from: Date.parse('2023-12-29T00:00:00Z'), until: Date.parse('2024-01-12T00:00:00Z') })
  })
  it('gives a sub-only window the broadcast wording, since the API has no sub timetable field', () => {
    const info = normalize({
      ...ONE_PIECE, delayedTimetable: 'On Break',
      subDelayedFrom: '2026-07-05T00:00:00Z', subDelayedUntil: '2026-07-19T00:00:00Z',
    }, DURING_DELAY)!
    expect(info.subDelay?.kind).toBe('break')
  })
  it('tolerates a payload with nothing but a route', () => {
    expect(normalize({ route: 'bare' }, DURING_DELAY)).toEqual({
      route: 'bare', delay: null, subDelay: null, dubDelay: null,
      jpnAt: null, subAt: null, dubAt: null, finished: false,
    })
  })
  it('is null for a body with no route at all', () => {
    expect(normalize(undefined, DURING_DELAY)).toBeNull()
    expect(normalize({} as RawAnime, DURING_DELAY)).toBeNull()
    expect(normalize({ title: 'no route' } as RawAnime, DURING_DELAY)).toBeNull()
  })
})

describe('labels', () => {
  it('names each delay state', () => {
    const until = Date.parse('2026-07-12T00:00:00Z')
    expect(delayLabel({ kind: 'break', from: null, until })).toBe(`On break until ${new Date(until).toLocaleDateString([], { month: 'short', day: 'numeric' })}`)
    expect(delayLabel({ kind: 'break', from: 1, until: null })).toBe('On break')
    expect(delayLabel({ kind: 'delayed', from: 1, until: null }, 'Sub')).toBe('Sub delayed')
    expect(delayLabel({ kind: 'break', from: 1, until: null }, 'Dub')).toBe('Dub on break')
    expect(delayLabel(null)).toBe('')
  })
  it('collapses a sub window that merely repeats the broadcast one', () => {
    const info = normalize({
      ...ONE_PIECE,
      subDelayedFrom: ONE_PIECE.delayedFrom, subDelayedUntil: ONE_PIECE.delayedUntil,
    }, DURING_DELAY)
    expect(delayLines(info)).toHaveLength(1)
  })
  it('orders broadcast before dub', () => {
    const info = normalize({
      ...FRIEREN, status: 'Ongoing',
      delayedUntil: '2026-08-10T00:00:00Z', dubDelayedUntil: '2026-08-20T00:00:00Z',
    }, AFTER_DELAY)
    expect(delayLines(info).map((l) => l.split(' until ')[0])).toEqual(['On break', 'Dub on break'])
  })
  it('has no lines at all when nothing is delayed', () => {
    expect(delayLines(normalize(ONE_PIECE, AFTER_DELAY))).toEqual([])
    expect(delayLines(null)).toEqual([])
  })
})

describe('local time', () => {
  // The API publishes slots in UTC; the viewer sees them wherever they are. Asserting against the
  // runtime's own formatter (rather than a hardcoded string) keeps this honest under any TZ.
  it('renders a slot as a local weekday and clock time', () => {
    const at = Date.parse('2026-02-18T20:00:00Z')
    const d = new Date(at)
    expect(slotLabel(at, at)).toBe(`${d.toLocaleDateString([], { weekday: 'short' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)
  })
  // These fields hold a PAST airing — months old on a long-running show (One Piece's live `subTime`
  // is 288 days old). Formatting that instant directly applies the UTC offset that was in effect
  // back then, so a viewer whose zone has crossed a DST boundary since is shown the wrong hour, and
  // at the edges the wrong weekday. The roll below is asserted on the instant rather than on the
  // formatted string because the two are indistinguishable in a UTC test runner — exactly the zone
  // where the bug does not bite.
  const WEEK = 7 * 864e5
  it('rolls a stale slot forward to its next occurrence', () => {
    const at = Date.parse('2026-02-18T20:00:00Z')
    const now = Date.parse('2026-08-01T00:00:00Z')
    const rolled = nextOccurrence(at, now)
    expect(rolled).toBeGreaterThan(now)
    expect(rolled - now).toBeLessThanOrEqual(WEEK)
    expect((rolled - at) % WEEK).toBe(0) // same weekday and wall-clock in Japan, which has no DST
  })
  it('leaves a slot that is already in the future alone', () => {
    const at = Date.parse('2026-08-08T12:00:00Z')
    expect(nextOccurrence(at, Date.parse('2026-08-01T00:00:00Z'))).toBe(at)
  })
  it('shows a DST-observing viewer the hour the NEXT airing lands on, not the stored one', () => {
    const at = Date.parse('2026-02-18T20:00:00Z') // 15:00 EST back in February…
    const now = Date.parse('2026-08-01T00:00:00Z') // …but 16:00 EDT for the occurrence coming up
    const ny = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' })
    expect(ny(at)).toBe('03:00 PM')
    expect(ny(nextOccurrence(at, now))).toBe('04:00 PM')
  })
  it('labels the rolled occurrence, not the stored instant', () => {
    const at = Date.parse('2026-02-18T20:00:00Z')
    const now = Date.parse('2026-08-01T00:00:00Z')
    const d = new Date(nextOccurrence(at, now))
    expect(slotLabel(at, now)).toBe(`${d.toLocaleDateString([], { weekday: 'short' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)
  })
  it('converts rather than echoing UTC when the zone is behind it', () => {
    // 2026-02-19T00:30Z is still the 18th in New York — the weekday must follow the viewer.
    const at = Date.parse('2026-02-19T00:30:00Z')
    const local = new Date(at).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' })
    expect(new Date(at).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })).toBe('Thu')
    expect(local).toBe('Wed')
  })
  it('is empty for an unset slot', () => expect(slotLabel(null)).toBe(''))
  it('lists sub and dub slots for an airing show', () =>
    expect(slotLines(normalize(ONE_PIECE, AFTER_DELAY))).toEqual([
      `Sub airs ${slotLabel(Date.parse('2025-10-17T16:00:00Z'))}`,
      `Dub airs ${slotLabel(Date.parse('2026-02-18T20:00:00Z'))}`,
    ]))
  it('hides slots on a finished show, where they are just the last episode', () =>
    expect(slotLines(normalize(FRIEREN, AFTER_DELAY))).toEqual([]))
  it('omits a slot the API left unset', () =>
    expect(slotLines(normalize({ ...ONE_PIECE, dubTime: ZERO }, AFTER_DELAY))).toEqual([`Sub airs ${slotLabel(Date.parse('2025-10-17T16:00:00Z'))}`]))
  it('is empty without an overlay', () => expect(slotLines(null)).toEqual([]))
})

describe('route resolution', () => {
  it('reads the AniList id out of the permalink, with or without a slug', () => {
    expect(anilistIdOf(FRIEREN)).toBe(154587)
    expect(anilistIdOf({ websites: { aniList: 'anilist.co/anime/459' } })).toBe(459)
    expect(anilistIdOf({ websites: {} })).toBeNull()
    expect(anilistIdOf({})).toBeNull()
  })
  it('normalizes punctuation and case out of a title', () => {
    expect(titleKey('Fate/Zero')).toBe(titleKey('Fate Zero'))
    expect(titleKey("Frieren: Beyond Journey's End")).toBe('frierenbeyondjourneysend')
  })
  it('offers romaji before english, the order the API indexes', () =>
    expect(scheduleTitles({ romaji: 'Sousou no Frieren', english: "Frieren: Beyond Journey's End" }))
      .toEqual(['Sousou no Frieren', "Frieren: Beyond Journey's End"]))

  it('prefers an exact id match over a closer-looking title', () => {
    const movie: RawAnime = { route: 'one-piece-movie', title: 'One Piece', websites: { aniList: 'anilist.co/anime/459' } }
    expect(pickEntry([movie, ONE_PIECE], 21, ['One Piece'])?.route).toBe('one-piece')
  })
  it('falls back to a title match only for entries with no AniList link', () => {
    const unlinked: RawAnime = { route: 'some-ova', title: 'Sousou no Frieren' }
    expect(pickEntry([unlinked], 154587, ['Sousou no Frieren'])?.route).toBe('some-ova')
  })
  it('never matches on title an entry that names a different id', () =>
    expect(pickEntry([ONE_PIECE], 999, ['One Piece'])).toBeNull())
  it('is null for an empty page or an unusable title list', () => {
    expect(pickEntry([], 21, ['One Piece'])).toBeNull()
    expect(pickEntry([{ route: 'x', title: 'X' }], 21, [undefined, '  '])).toBeNull()
  })
})

describe('lookup', () => {
  // The module memoizes per AniList id for the process lifetime, so each case needs its own id —
  // and the search fixture has to carry that id, since resolution matches on the permalink.
  const linked = (id: number, route: string): RawAnime =>
    ({ ...ONE_PIECE, route, websites: { aniList: `anilist.co/anime/${id}/One-Piece` } })
  /** Some other title on the same search page — a route, a real id, and never the wanted one. */
  const other = (n: number): RawAnime =>
    ({ route: `other-${n}`, title: `Other ${n}`, websites: { aniList: `anilist.co/anime/${90000 + n}/Other` } })
  const page = (anime: RawAnime[], totalAmount = anime.length) => ({ ok: true, json: async () => ({ page: 1, totalAmount, anime }) })
  const detail = (raw: RawAnime) => ({ ok: true, json: async () => raw })

  // A stand-in for idb rather than a bare stub: what a lookup writes has to be visible to the read
  // that follows it, which is the whole point of keeping the search entry.
  const store = new Map<string, unknown>()
  const stamped = (value: unknown, ageMs = 0) => ({ at: Date.now() - ageMs, value })

  beforeEach(() => {
    vi.restoreAllMocks()
    store.clear()
    mocks.get.mockReset().mockImplementation(async (k: string) => store.get(k))
    mocks.set.mockReset().mockImplementation(async (k: string, v: unknown) => { store.set(k, v) })
    mocks.del.mockReset().mockImplementation(async (k: string) => { store.delete(k) })
    mocks.phttp.mockReset()
  })

  it('resolves a cold title in ONE request, from the search entry itself', async () => {
    mocks.phttp.mockResolvedValueOnce(page([linked(21, 'one-piece')]))

    expect((await getScheduleInfo(21, ['One Piece']))?.route).toBe('one-piece')
    expect(mocks.phttp).toHaveBeenCalledTimes(1) // the search answer IS the detail payload
    expect(mocks.phttp.mock.calls[0][0]).toContain('?q=One%20Piece')
    expect(mocks.set.mock.calls.map((c) => c[0])).toEqual(['animeschedule-route-21', 'animeschedule-anime-one-piece'])
  })

  it('fetches the detail endpoint once the kept payload has aged out', async () => {
    store.set('animeschedule-route-34', stamped('op-34'))
    store.set('animeschedule-anime-op-34', stamped(linked(34, 'op-34'), 7 * 3600e3))
    mocks.phttp.mockResolvedValueOnce(detail(linked(34, 'op-34')))

    expect((await getScheduleInfo(34, ['One Piece']))?.route).toBe('op-34')
    expect(mocks.phttp.mock.calls[0][0]).toContain('/anime/op-34')
    expect(mocks.del).toHaveBeenCalledWith('animeschedule-anime-op-34') // and the stale copy is gone
  })

  it('coalesces concurrent callers for the same title into one lookup', async () => {
    mocks.phttp.mockResolvedValueOnce(page([linked(22, 'op-22')]))

    const [a, b] = await Promise.all([getScheduleInfo(22, ['One Piece']), getScheduleInfo(22, ['One Piece'])])
    expect(a).toBe(b)
    expect(mocks.phttp).toHaveBeenCalledTimes(1)
  })

  it('serves a cached route and payload without touching the network', async () => {
    store.set('animeschedule-route-23', stamped('one-piece'))
    store.set('animeschedule-anime-one-piece', stamped(ONE_PIECE))

    expect((await getScheduleInfo(23, ['One Piece']))?.route).toBe('one-piece')
    expect(mocks.phttp).not.toHaveBeenCalled()
  })

  it('answers a repeat lookup from memory, without idb or the network', async () => {
    mocks.phttp.mockResolvedValueOnce(page([linked(35, 'op-35')]))
    expect((await getScheduleInfo(35, ['One Piece']))?.route).toBe('op-35')

    mocks.get.mockClear()
    expect((await getScheduleInfo(35, ['One Piece']))?.route).toBe('op-35')
    expect(mocks.get).not.toHaveBeenCalled()
    expect(mocks.phttp).toHaveBeenCalledTimes(1)
  })

  it('degrades to null when the route cannot be resolved', async () => {
    mocks.phttp.mockResolvedValueOnce(page([]))
    expect(await getScheduleInfo(24, ['Nothing Here'])).toBeNull()
  })

  it('stops re-searching a title the API answered for but does not carry', async () => {
    mocks.phttp.mockResolvedValue(page([]))
    expect(await getScheduleInfo(25, ['Nothing Here'])).toBeNull()
    expect(await getScheduleInfo(25, ['Nothing Here'])).toBeNull()
    expect(mocks.phttp).toHaveBeenCalledTimes(1)
  })

  it('tries every title it was given before writing a show off', async () => {
    mocks.phttp
      .mockResolvedValueOnce(page([other(1)]))
      .mockResolvedValueOnce(page([linked(36, 'op-36')]))

    expect((await getScheduleInfo(36, ['Romaji Name', 'English Name']))?.route).toBe('op-36')
    expect(mocks.phttp.mock.calls.map((c) => String(c[0]).split('?q=')[1])).toEqual(['Romaji%20Name', 'English%20Name'])
  })

  it('reads the second page when the first is full and the id is not on it', async () => {
    const first = Array.from({ length: 18 }, (_, i) => other(i))
    mocks.phttp
      .mockResolvedValueOnce(page(first, 40))
      .mockResolvedValueOnce(page([linked(37, 'op-37')], 40))

    expect((await getScheduleInfo(37, ['Franchise']))?.route).toBe('op-37')
    expect(mocks.phttp.mock.calls[1][0]).toContain('&page=2')
  })

  it('does not ask for a page the search says is not there', async () => {
    mocks.phttp.mockResolvedValue(page([other(1)], 1))
    expect(await getScheduleInfo(38, ['Only One Result'])).toBeNull()
    expect(mocks.phttp).toHaveBeenCalledTimes(1)
  })

  it('retries after a failed search instead of pinning the title off', async () => {
    mocks.phttp.mockRejectedValueOnce(new Error('offline'))
    expect(await getScheduleInfo(26, ['One Piece'])).toBeNull()

    mocks.phttp.mockResolvedValueOnce(page([linked(26, 'op-26')]))
    expect((await getScheduleInfo(26, ['One Piece']))?.route).toBe('op-26')
  })

  it('does not remember a rate-limited search either', async () => {
    mocks.phttp.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) })
    expect(await getScheduleInfo(27, ['One Piece'])).toBeNull()
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('does not conclude anything from a search that failed on the second title', async () => {
    mocks.phttp
      .mockResolvedValueOnce(page([other(2)]))
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
    expect(await getScheduleInfo(39, ['Romaji Name', 'English Name'])).toBeNull()

    mocks.phttp.mockResolvedValueOnce(page([linked(39, 'op-39')]))
    expect((await getScheduleInfo(39, ['One Piece']))?.route).toBe('op-39')
  })

  it('never caches a 200 whose body has no route', async () => {
    store.set('animeschedule-route-28', stamped('op-28'))
    mocks.phttp.mockResolvedValueOnce({ ok: true, json: async () => ({}) })

    expect(await getScheduleInfo(28, ['One Piece'])).toBeNull()
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('skips the search entirely when no usable title is available', async () => {
    expect(await resolveRoute(29, [undefined, '   '])).toBeNull()
    expect(mocks.phttp).not.toHaveBeenCalled()
  })

  it('survives an unavailable idb without losing the lookup', async () => {
    const hit = linked(30, 'op-30')
    mocks.get.mockRejectedValue(new Error('no idb'))
    mocks.set.mockRejectedValue(new Error('no idb'))
    mocks.phttp
      .mockResolvedValueOnce(page([hit]))
      .mockResolvedValueOnce(detail(hit)) // nothing was kept, so the detail GET is back

    expect((await getScheduleInfo(30, ['One Piece']))?.route).toBe('op-30')
  })

  it('caps a batch and returns only the titles it could resolve', async () => {
    mocks.phttp
      .mockResolvedValueOnce(page([linked(31, 'op-31')]))
      .mockResolvedValue(page([]))

    const map = await getScheduleInfoMany(
      [{ id: 31, titles: ['One Piece'] }, { id: 32, titles: ['Nothing Here'] }, { id: 33, titles: ['Nothing Either'] }],
      { limit: 2, concurrency: 1 },
    )
    expect([...map.keys()]).toEqual([31])
    expect(map.get(31)?.route).toBe('op-31')
  })
})
