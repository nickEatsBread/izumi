import { describe, expect, it } from 'vitest'
import { FACT_KEYS, FACT_LABEL_TEXT, FACT_LABELS } from '$lib/themes/presentation'
import { countryName, factDate, formatDate, INFO_KEYS, mediaFacts, prettyEnum } from './facts'

const media = {
  id: 1, format: 'TV', status: 'RELEASING', episodes: 24, duration: 24, season: 'SPRING', seasonYear: 2026,
  source: 'LIGHT_NOVEL', countryOfOrigin: 'JP', averageScore: 83, popularity: 125000,
  startDate: { year: 2026, month: 4, day: 3 },
  studios: { nodes: [{ id: 7, name: '8-bit' }] }, title: { romaji: 'T' },
  genres: ['Action', 'Comedy'],
}
// A finished title with every API 4 fact.
const finished = {
  ...media, status: 'FINISHED', endDate: { year: 2026, month: 9, day: 18 }, favourites: 18400,
  title: { romaji: 'Sousou no Frieren', english: "Frieren: Beyond Journey's End", native: '葬送のフリーレン' },
  studios: { nodes: [{ id: 7, name: '8-bit' }, { name: 'Lantern' }] },
  staff: { edges: [
    { role: 'Director', node: { id: 10, name: { full: 'A Director' } } },
    { role: 'Original Creator', node: { id: 11, name: { full: 'Eiichirou Oda' } } },
    { role: 'Original Story (Light Novel)', node: { id: 12, name: { full: 'B Writer' } } },
    { role: 'Original Creator', node: { id: 11, name: { full: 'Eiichirou Oda' } } },
  ] },
}
const fact = (facts: ReturnType<typeof mediaFacts>, key: string) => facts.find((entry) => entry.key === key)
const locale = (date: Date, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(date)

describe('series facts', () => {
  it('formats enum and date values', () => {
    expect(prettyEnum('LIGHT_NOVEL')).toBe('Light Novel')
    expect(countryName('JP')).toBe('Japan')
    expect(countryName('FR')).toBe('FR')
    expect(formatDate({ year: 2026, month: 4, day: 3 })).toBe('2026-4-3')
    expect(formatDate(null)).toBe('')
  })

  it('lists the standard facts in reading order, skipping unknown values', () => {
    const facts = mediaFacts(media as never)
    expect(facts.map((fact) => fact.key)).toEqual(['format', 'episodes', 'status', 'aired', 'season', 'duration', 'studio', 'source', 'country', 'score', 'members', 'genres'])
    expect(fact(facts, 'aired')?.value).toBe('2026-4-3')
    expect(fact(facts, 'studio')).toMatchObject({ value: '8-bit', href: '/app/studio/7' })
    expect(fact(facts, 'members')?.value).toMatch(/125/)
    expect(mediaFacts({ id: 2, title: { romaji: 'x' } } as never)).toEqual([])
  })

  it('leads with the progress line when there is progress', () => {
    const facts = mediaFacts(media as never, { progress: '3/24' })
    expect(facts[0]).toMatchObject({ key: 'progress', label: 'Watched', value: '3/24' })
  })

  it('adds a genres fact as the last entry, with one link per genre', () => {
    const facts = mediaFacts(media as never)
    expect(facts.at(-1)).toMatchObject({
      key: 'genres',
      label: 'Genres',
      value: 'Action, Comedy',
      links: [
        { text: 'Action', href: '/app/search?genre=Action' },
        { text: 'Comedy', href: '/app/search?genre=Comedy' },
      ],
    })
    expect(mediaFacts({ id: 2, title: { romaji: 'x' }, genres: [] } as never)).toEqual([])
  })
})

// API 4: `detail.factsKeys` / `infoKeys`, `factsLabels` and `factsFormat`.
describe('theme-chosen facts', () => {
  it('shows exactly the listed facts, in the listed order', () => {
    const facts = mediaFacts(finished as never, { keys: ['status', 'format', 'year', 'duration'] })
    expect(facts.map((entry) => [entry.key, entry.label, entry.value])).toEqual([
      ['status', 'Status', 'Finished'], ['format', 'Type', 'TV'], ['year', 'Year', '2026'], ['duration', 'Duration', '24 min'],
    ])
    // The progress line too, only where it is listed.
    expect(mediaFacts(media as never, { keys: ['format'], progress: '3/24' }).map((entry) => entry.key)).toEqual(['format'])
    expect(mediaFacts(media as never, { keys: ['score', 'progress'], progress: '3/24' }).map((entry) => entry.key)).toEqual(['score', 'progress'])
  })

  it('knows every key', () => {
    const facts = mediaFacts(finished as never, { keys: FACT_KEYS, progress: '3/24' })
    expect(facts.map((entry) => entry.key)).toEqual(FACT_KEYS)
    expect(fact(facts, 'year')?.value).toBe('2026')
    expect(fact(facts, 'ended')?.value).toBe('2026-9-18')
    expect(fact(facts, 'favourites')?.value).toMatch(/18/)
    // The original creator, once, then the original story; never the director.
    expect(fact(facts, 'author')).toMatchObject({
      value: 'Eiichirou Oda, B Writer',
      links: [{ text: 'Eiichirou Oda', href: '/app/staff/11' }, { text: 'B Writer', href: '/app/staff/12' }],
    })
  })

  it('leaves out an end date while the title airs, and an author nobody credits', () => {
    const airing = mediaFacts({ ...finished, status: 'RELEASING' } as never, { keys: ['ended', 'author'] })
    expect(airing.map((entry) => entry.key)).toEqual(['author'])
    expect(mediaFacts({ ...media, staff: { edges: [] } } as never, { keys: ['author', 'favourites', 'year'] }).map((entry) => entry.key)).toEqual(['year'])
    // A provider's creator names stand in for AniList's staff credits.
    expect(fact(mediaFacts({ ...media, creators: ['Someone'] } as never, { keys: ['author'] }), 'author')?.value).toBe('Someone')
  })

  it('takes a name from each key\'s fixed list, and ignores any other', () => {
    for (const key of FACT_KEYS) {
      expect(FACT_LABELS[key].length).toBeGreaterThan(0)
      for (const name of FACT_LABELS[key]) {
        const [entry] = mediaFacts(finished as never, { keys: [key], labels: { [key]: name }, progress: '3/24' })
        expect(entry?.label, `${key} ${name}`).toBe(FACT_LABEL_TEXT[name])
      }
    }
    expect(fact(mediaFacts(media as never, { labels: { format: 'start-date' as never } }), 'format')?.label).toBe('Type')
  })

  it('formats scores out of a hundred or ten', () => {
    expect(fact(mediaFacts(media as never, { format: { score: 'percent' } }), 'score')).toMatchObject({ value: '83%' })
    expect(fact(mediaFacts(media as never, { format: { score: 'ten' } }), 'score')).toEqual({ key: 'score', label: 'Score', value: '8.3' })
    expect(fact(mediaFacts(media as never, { format: { score: 'ten-of' } }), 'score')).toMatchObject({ value: '8.3', suffix: ' / 10' })
  })

  it('formats dates numerically or in the viewer\'s locale', () => {
    const start = new Date(Date.UTC(2026, 3, 3))
    expect(fact(mediaFacts(media as never, { format: { dates: 'numeric' } }), 'aired')?.value).toBe('2026-4-3')
    expect(fact(mediaFacts(media as never, { format: { dates: 'short' } }), 'aired')?.value).toBe(locale(start, { year: 'numeric', month: 'numeric', day: 'numeric' }))
    expect(fact(mediaFacts(finished as never, { keys: ['ended'], format: { dates: 'long' } }), 'ended')?.value).toBe(locale(new Date(Date.UTC(2026, 8, 18)), { year: 'numeric', month: 'long', day: 'numeric' }))
    // A date known to the month or the year keeps only what is known.
    expect(factDate({ year: 2026, month: 4 }, 'long')).toBe(locale(start, { year: 'numeric', month: 'long' }))
    expect(factDate({ year: 2026 }, 'short')).toBe('2026')
    expect(factDate(null, 'long')).toBe('')
  })

  it('formats counts compactly or in full', () => {
    const full = new Intl.NumberFormat(undefined).format(125000)
    const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(125000)
    expect(fact(mediaFacts(media as never), 'members')?.value).toBe(compact)
    expect(fact(mediaFacts(media as never, { format: { counts: 'full' } }), 'members')?.value).toBe(full)
    expect(fact(mediaFacts(finished as never, { keys: ['favourites'], format: { counts: 'full' } }), 'favourites')?.value).toBe(new Intl.NumberFormat(undefined).format(18400))
  })
})

// The phone Overview's Information grid.
describe('the Information grid', () => {
  it("keeps izumi's own facts and wording without infoKeys", () => {
    const facts = mediaFacts(finished as never, { place: 'info' })
    expect(facts.map((entry) => entry.key)).toEqual(INFO_KEYS)
    expect(facts.map((entry) => [entry.label, entry.value])).toEqual([
      ['Studio', '8-bit, Lantern'], ['Format', 'TV'], ['Status', 'Finished'], ['Episodes', '24'], ['Runtime', '24 minutes'],
      ['Season', 'Spring 2026'], ['Premiered', '2026-4-3'], ['Source', 'Light Novel'], ['Country', 'Japan'], ['Score', '83%'],
      ['Popularity', `${new Intl.NumberFormat(undefined).format(125000)} members`],
    ])
    // Every studio links to its page.
    expect(fact(facts, 'studio')?.links).toEqual([{ text: '8-bit', href: '/app/studio/7' }, { text: 'Lantern', href: '/app/search?search=Lantern' }])
    expect(fact(mediaFacts({ ...media, episodes: undefined } as never, { place: 'info' }), 'episodes')?.value).toBe('Unknown')
  })

  it("takes a theme's names and formats over its own wording", () => {
    const facts = mediaFacts(finished as never, { place: 'info', labels: { members: 'members', aired: 'start-date' }, format: { score: 'ten-of', counts: 'compact' } })
    expect(fact(facts, 'aired')?.label).toBe('Start Date')
    expect(fact(facts, 'members')?.label).toBe('Members')
    expect(fact(facts, 'members')?.value).toMatch(/ members$/)
    expect(fact(facts, 'score')).toMatchObject({ value: '8.3', suffix: ' / 10' })
  })

  it('uses the standard wording for the facts a theme lists', () => {
    const facts = mediaFacts(finished as never, { place: 'info', keys: ['aired', 'ended', 'season', 'members', 'favourites'], labels: { members: 'popularity', favourites: 'favorites' }, format: { dates: 'short' } })
    expect(facts.map((entry) => entry.label)).toEqual(['Aired', 'Ended', 'Season', 'Popularity', 'Favorites'])
    expect(fact(facts, 'members')?.value).not.toMatch(/members/)
  })
})

// While the page loads from the card the user tapped, a fact the card cannot fill is a placeholder.
describe('facts while the page loads', () => {
  const hint = { id: 3, title: { romaji: 'Hint' }, format: 'TV', status: 'RELEASING' }
  it('holds a placeholder instead of "Unknown" or a missing fact', () => {
    const facts = mediaFacts(hint as never, { place: 'info', pending: true })
    expect(facts.map((entry) => entry.key)).toEqual(INFO_KEYS)
    expect(fact(facts, 'format')).toMatchObject({ value: 'TV' })
    expect(fact(facts, 'episodes')).toEqual({ key: 'episodes', label: 'Episodes', value: '', pending: true })
    expect(facts.some((entry) => entry.value === 'Unknown')).toBe(false)
  })
  it('never waits on the viewer\'s progress or on an end date the status rules out', () => {
    const facts = mediaFacts(hint as never, { keys: ['progress', 'ended', 'favourites'], pending: true })
    expect(facts.map((entry) => [entry.key, entry.pending])).toEqual([['favourites', true]])
  })
})

// API 4: the title names as facts, raw counts and the running time in words or short.
describe('names and the newer formats', () => {
  it('lists the romaji, English and native titles as facts of their own', () => {
    const facts = mediaFacts(finished as never, { place: 'info', keys: ['romaji', 'english', 'native'], labels: { romaji: 'name-romaji', english: 'name' } })
    expect(facts.map((entry) => [entry.key, entry.label, entry.value])).toEqual([
      ['romaji', 'Name Romaji', 'Sousou no Frieren'], ['english', 'Name', "Frieren: Beyond Journey's End"], ['native', 'Native', '葬送のフリーレン'],
    ])
    // A title without an English name has no English fact; while loading it holds a placeholder.
    expect(mediaFacts(media as never, { keys: ['romaji', 'english'] }).map((entry) => entry.key)).toEqual(['romaji'])
    expect(fact(mediaFacts({ id: 3, title: {} } as never, { keys: ['native'], pending: true }), 'native')).toMatchObject({ pending: true })
  })

  it('prints counts without grouping', () => {
    expect(fact(mediaFacts(media as never, { format: { counts: 'raw' } }), 'members')?.value).toBe('125000')
    expect(fact(mediaFacts(finished as never, { place: 'info', format: { counts: 'raw' } }), 'members')?.value).toBe('125000 members')
    expect(fact(mediaFacts(finished as never, { keys: ['favourites'], format: { counts: 'raw' } }), 'favourites')?.value).toBe('18400')
  })

  it('writes the running time in words, short, or as izumi does', () => {
    const long = { ...media, duration: 105 }
    expect(fact(mediaFacts(media as never, { format: { duration: 'long' } }), 'duration')?.value).toBe('24 mins')
    expect(fact(mediaFacts(long as never, { format: { duration: 'long' } }), 'duration')?.value).toBe('1 hr 45 mins')
    expect(fact(mediaFacts(media as never, { format: { duration: 'short' } }), 'duration')?.value).toBe('24m')
    expect(fact(mediaFacts(long as never, { format: { duration: 'short' } }), 'duration')?.value).toBe('1h 45m')
    expect(fact(mediaFacts({ ...media, duration: 120 } as never, { format: { duration: 'short' } }), 'duration')?.value).toBe('2h')
    // `min` is the facts' own wording, also in the Information grid, which otherwise writes minutes out.
    expect(fact(mediaFacts(media as never, { place: 'info', format: { duration: 'min' } }), 'duration')?.value).toBe('24 min')
    expect(fact(mediaFacts(media as never, { place: 'info' }), 'duration')?.value).toBe('24 minutes')
    expect(fact(mediaFacts(media as never), 'duration')?.value).toBe('24 min')
    expect(fact(mediaFacts(media as never, { place: 'info', format: { duration: 'long' } }), 'duration')?.value).toBe('24 mins')
  })
})
