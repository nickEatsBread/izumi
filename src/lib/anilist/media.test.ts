import { describe, it, expect } from 'vitest'
import { title, banner, format, ratingBg, airedCount, resumeEp, hasAiredEpisodeToWatch } from './media'

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
})
