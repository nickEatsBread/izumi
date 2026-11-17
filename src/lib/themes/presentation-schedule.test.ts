import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Airing } from '$lib/anilist/schedule'
import type { Media } from '$lib/anilist/types'
import { airingDisplayModel } from './host-model'
import { parsePresentation, resolvePresentation, themeCoverage } from './presentation'

const item = { type: 'row', children: [{ type: 'text', field: 'airTime' }, { type: 'text', field: 'title' }, { type: 'text', field: 'listStatus', when: { field: 'listStatus' } }] }
const media = { id: 1, title: { romaji: 'Frieren' }, coverImage: { large: 'cover.jpg' }, format: 'TV' } as unknown as Media

describe('schedule (API 8)', () => {
  it('parses an entry template on API 8 packages only, display-only', () => {
    expect(parsePresentation({ schedule: { item } }, 8).schedule?.item).toEqual(item)
    expect(() => parsePresentation({ schedule: { item } }, 7)).toThrow('unsupported')
    expect(() => parsePresentation({ schedule: { item: { type: 'action', action: 'play' } } })).toThrow('actions')
    expect(() => parsePresentation({ schedule: { day: item } })).toThrow()
  })
  it('gates the four airing fields to API 8', () => {
    for (const field of ['airTime', 'airingLabel', 'listStatus', 'delay']) {
      expect(() => parsePresentation({ cards: { poster: { type: 'text', field } } }, 8)).not.toThrow()
      expect(() => parsePresentation({ cards: { poster: { type: 'text', field } } }, 7)).toThrow()
    }
  })
  it('layers the phone and TV blocks and counts as Shell', () => {
    const shared = parsePresentation({ schedule: { item }, mobile: { schedule: { item: { type: 'text', field: 'title' } } } })
    expect(resolvePresentation(shared, true)?.schedule?.item).toEqual({ type: 'text', field: 'title' })
    expect(resolvePresentation(shared, false)?.schedule?.item).toEqual(item)
    expect(themeCoverage(parsePresentation({ schedule: { item } }))).toEqual(['Shell'])
  })
  it('binds an airing: its episode, time, own line, your tracking and a countdown only before it airs', () => {
    const now = Date.UTC(2026, 10, 16, 12) // 12:00 UTC
    const at = now / 1000 + 2 * 3600 + 5 * 60
    const coming = airingDisplayModel({ airingAt: at, episode: 9, media } satisfies Airing, 'watching', 'Delayed a week', now)
    expect(coming).toMatchObject({ title: 'Frieren', episodeNumber: 9, episodeNo: '9', airingLabel: 'Episode 9', listStatus: 'Watching', delay: 'Delayed a week', airingIn: '2h 5m', airingCountdown: '2 hrs 5 mins' })
    expect(coming.airTime).toBeTruthy()
    const done = airingDisplayModel({ airingAt: now / 1000 - 60, episode: 8, media, season: 2, providerEpisode: 8, source: 'tmdb' }, null, '', now)
    expect(done).toMatchObject({ airingLabel: 'S2 E8' })
    expect(done.airingIn).toBeUndefined()
    expect(done.listStatus).toBeUndefined()
    expect(done.delay).toBeUndefined()
    // A calendar that knows only the day has no time; a delay placeholder never counts down.
    expect(airingDisplayModel({ airingAt: at, episode: 1, media, timeKnown: false }, 'watched', '', now)).toMatchObject({ listStatus: 'Watched', airTime: undefined })
    expect(airingDisplayModel({ airingAt: at, episode: 1, media, delayPlaceholder: true }, null, '', now).airingIn).toBeUndefined()
  })
  it('draws the template inside the same entry link in the agenda and the day view', () => {
    for (const file of ['AgendaWeek.svelte', 'DayColumn.svelte']) {
      const text = readFileSync(fileURLToPath(new URL(`../components/schedule/${file}`, import.meta.url)), 'utf8')
      expect(text, file).toContain('const itemTemplate = $derived($themePresentation?.schedule?.item)')
      expect(text, file).toContain('<ThemeNode node={itemTemplate} model={airingDisplayModel(a, mine, delay)} />')
      // The remove button stays outside the link either way.
      expect(text.indexOf('{#if mine}<ScheduleRemove'), file).toBeGreaterThan(text.indexOf('<ThemeNode node={itemTemplate}'))
    }
  })
})
