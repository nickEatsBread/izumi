import { describe, it, expect } from 'vitest'
import { title, banner, format, ratingBg, airedCount, totalEpisodes, resumeEp, hasAiredEpisodeToWatch } from './media'

describe('media helpers', () => {
  it('title prefers userPreferred, falls back to TBA', () => {
    expect(title({ id: 1, title: { userPreferred: 'Frieren' } } as any)).toBe('Frieren')
    expect(title({ id: 1, title: {} } as any)).toBe('TBA')
  })
  it('banner prefers bannerImage, then youtube thumb, then cover', () => {
    expect(banner({ id: 1, title: {}, bannerImage: 'b.jpg' } as any)).toBe('b.jpg')
    expect(banner({ id: 1, title: {}, trailer: { id: 'YT', site: 'youtube' } } as any))
      .toBe('https://i.ytimg.com/vi/YT/maxresdefault.jpg')
    expect(banner({ id: 1, title: {}, coverImage: { extraLarge: 'c.jpg' } } as any)).toBe('c.jpg')
  })
  it('format maps enum to label', () => {
    expect(format({ id: 1, title: {}, format: 'TV_SHORT' } as any)).toBe('TV Short')
    expect(format({ id: 1, title: {}, format: 'MOVIE' } as any)).toBe('Movie')
  })
  it('ratingBg buckets by score', () => {
    expect(ratingBg(80)).toContain('green'); expect(ratingBg(70)).toContain('orange'); expect(ratingBg(50)).toContain('red')
  })
  it('hides caught-up shows until another episode has aired', () => {
    const airing = { id: 1, title: {}, episodes: 12, nextAiringEpisode: { episode: 5, timeUntilAiring: 3600 } } as any
    expect(airedCount(airing)).toBe(4)
    expect(hasAiredEpisodeToWatch(airing, 3)).toBe(true)
    expect(hasAiredEpisodeToWatch(airing, 4)).toBe(false)

    const nextAired = { ...airing, nextAiringEpisode: { episode: 6, timeUntilAiring: 3600 } }
    expect(hasAiredEpisodeToWatch(nextAired, 4)).toBe(true)
    expect(resumeEp(nextAired, 4)).toBe(5)
  })
  it('hides a finished show once every episode is watched', () => {
    const finished = { id: 1, title: {}, status: 'FINISHED', episodes: 12 } as any
    expect(hasAiredEpisodeToWatch(finished, 11)).toBe(true)
    expect(hasAiredEpisodeToWatch(finished, 12)).toBe(false)
  })

  it('recovers aired/total from airingSchedule when AniList episode count is null', () => {
    // RELEASING OVA (mirrors AniList id 178445): episodes + nextAiringEpisode are both
    // null; the only episode signal is a fully-aired airingSchedule.
    const past = Math.floor(Date.now() / 1000) - 86400
    const ova = {
      id: 1, title: {}, status: 'RELEASING', episodes: null, nextAiringEpisode: null,
      airingSchedule: { nodes: [1, 2, 3, 4].map((episode) => ({ episode, airingAt: past })) },
    } as any
    expect(totalEpisodes(ova)).toBe(4)
    expect(airedCount(ova)).toBe(4)
    expect(hasAiredEpisodeToWatch(ova, 3)).toBe(true)
    expect(hasAiredEpisodeToWatch(ova, 4)).toBe(false)
  })

  it('counts only already-aired schedule nodes toward airedCount', () => {
    const past = Math.floor(Date.now() / 1000) - 86400
    const future = Math.floor(Date.now() / 1000) + 86400
    const partial = {
      id: 1, title: {}, status: 'RELEASING', episodes: null, nextAiringEpisode: null,
      airingSchedule: { nodes: [
        { episode: 1, airingAt: past }, { episode: 2, airingAt: past },
        { episode: 3, airingAt: future }, { episode: 4, airingAt: future },
      ] },
    } as any
    expect(totalEpisodes(partial)).toBe(4) // planned total from the whole schedule
    expect(airedCount(partial)).toBe(2)    // but only two have aired
  })

  it('keeps nextAiringEpisode authoritative over the schedule', () => {
    const past = Math.floor(Date.now() / 1000) - 86400
    const tv = {
      id: 1, title: {}, episodes: 12, nextAiringEpisode: { episode: 5, timeUntilAiring: 3600 },
      airingSchedule: { nodes: [{ episode: 1, airingAt: past }, { episode: 2, airingAt: past }] },
    } as any
    expect(airedCount(tv)).toBe(4)     // 5-1, not the 2 schedule nodes
    expect(totalEpisodes(tv)).toBe(12) // AniList's own count wins
  })

  it('totalEpisodes is 0 only when nothing is known', () => {
    expect(totalEpisodes({ id: 1, title: {}, status: 'RELEASING' } as any)).toBe(0)
    expect(totalEpisodes({ id: 1, title: {}, episodes: 24 } as any)).toBe(24)
  })
})
