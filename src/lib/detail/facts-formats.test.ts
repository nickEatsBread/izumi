import { describe, expect, it } from 'vitest'
import type { Media } from '$lib/anilist/types'
import { episodesFact, mediaFacts, statusText, studioHref } from './facts'

const NOW = Math.floor(Date.now() / 1000)
const airing = (over: Partial<Media> = {}): Media => ({
  id: 21, title: { romaji: 'Long Runner' }, status: 'RELEASING', episodes: null, format: 'TV',
  nextAiringEpisode: { episode: 1148, airingAt: NOW + 3600, timeUntilAiring: 3600 },
  ...over,
} as unknown as Media)
const fact = (m: Media, key: string, format: object) => mediaFacts(m, { keys: [key as never], format })[0]

describe('plain status words (factsFormat.status)', () => {
  it('reads Ongoing, Completed, Hiatus and Cancelled, and nothing for a title not out yet', () => {
    expect(statusText({ status: 'RELEASING' }, 'plain')).toBe('Ongoing')
    expect(statusText({ status: 'FINISHED' }, 'plain')).toBe('Completed')
    expect(statusText({ status: 'HIATUS' }, 'plain')).toBe('Hiatus')
    expect(statusText({ status: 'CANCELLED' }, 'plain')).toBe('Cancelled')
    expect(statusText({ status: 'NOT_YET_RELEASED' }, 'plain')).toBe('')
    expect(statusText({}, 'plain')).toBe('')
  })
  it("keeps the catalog's word without it", () => {
    expect(statusText({ status: 'RELEASING' })).toBe('Releasing')
    expect(statusText({ status: 'FINISHED' }, 'catalog')).toBe('Finished')
    expect(statusText({ status: 'NOT_YET_RELEASED' })).toBe('Not Yet Released')
  })
  it('feeds the status fact, and leaves it out for a title not out yet', () => {
    expect(fact(airing(), 'status', { status: 'plain' })?.value).toBe('Ongoing')
    expect(fact(airing(), 'status', {})?.value).toBe('Releasing')
    expect(mediaFacts(airing({ status: 'NOT_YET_RELEASED' } as Partial<Media>), { keys: ['status'], format: { status: 'plain' } })).toEqual([])
  })
})

describe('aired episode counts (factsFormat.episodes)', () => {
  it('reads "1147 / ?" on a long runner without a planned total', () => {
    expect(episodesFact(airing(), 'aired-of')).toEqual({ value: '1147', suffix: ' / ?' })
    const episodes = fact(airing(), 'episodes', { episodes: 'aired-of' })
    expect(episodes).toMatchObject({ key: 'episodes', value: '1147', suffix: ' / ?' })
  })
  it('reads the aired count over the planned total while a title airs', () => {
    const title = airing({ episodes: 26, nextAiringEpisode: { episode: 15, airingAt: NOW + 60, timeUntilAiring: 60 } } as Partial<Media>)
    expect(episodesFact(title, 'aired-of')).toEqual({ value: '14', suffix: ' / 26' })
    expect(episodesFact(title, 'aired')).toEqual({ value: '14', suffix: undefined })
    expect(episodesFact(title)).toEqual({ value: '26' })
  })
  it('reads the total of a title that is not airing', () => {
    const finished = airing({ status: 'FINISHED', episodes: 28, nextAiringEpisode: null } as Partial<Media>)
    expect(episodesFact(finished, 'aired-of')).toEqual({ value: '28' })
    expect(episodesFact(finished, 'aired')).toEqual({ value: '28' })
    const upcoming = airing({ status: 'NOT_YET_RELEASED', episodes: 12, nextAiringEpisode: { episode: 1, airingAt: NOW + 60, timeUntilAiring: 60 } } as Partial<Media>)
    expect(episodesFact(upcoming, 'aired-of')).toEqual({ value: '12' })
  })
  it('reads the total while the aired count is unknown', () => {
    const unknown = airing({ episodes: 24, nextAiringEpisode: null } as Partial<Media>)
    expect(episodesFact(unknown, 'aired-of')).toEqual({ value: '24' })
  })
  it("keeps izumi's own count and the Information grid's Unknown", () => {
    const blank = airing({ status: 'FINISHED', nextAiringEpisode: null } as Partial<Media>)
    expect(mediaFacts(blank, { place: 'info' }).find((item) => item.key === 'episodes')?.value).toBe('Unknown')
  })
})

describe('the studio link', () => {
  it("opens the studio's page, or a search for it", () => {
    expect(studioHref({ id: 11, name: 'MADHOUSE' })).toBe('/app/studio/11')
    expect(studioHref({ name: 'Studio X' })).toBe('/app/search?search=Studio%20X')
  })
})
