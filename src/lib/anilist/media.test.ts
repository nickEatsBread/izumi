import { describe, it, expect } from 'vitest'
import { title, banner, cardCover, format, mediaHref, isReadingMedia, ratingBg, airedCount, totalEpisodes, resumeEp, hasAiredEpisodeToWatch } from './media'

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
  it('cardCover picks the smallest asset that still covers the painted pixels', () => {
    const m = { id: 1, title: {}, coverImage: { large: 'l.jpg', extraLarge: 'xl.jpg', medium: 'm.jpg' } } as any
    // AniList's `large` is 230px wide. A 152px card on a 1x monitor is covered three times over.
    ;(globalThis as any).window = { devicePixelRatio: 1 }
    expect(cardCover(m, 152)).toBe('l.jpg')
    // The same card on a 2.75x phone needs ~300 real pixels, so the big asset is the correct one -
    // density decides this, not platform. DPR is budgeted at 2x, past which the bytes stop paying.
    ;(globalThis as any).window = { devicePixelRatio: 2.75 }
    expect(cardCover(m, 131)).toBe('xl.jpg')
    // A caller that cannot state a width (fill-width cell, 16:9 fallback) must not be guessed small.
    expect(cardCover(m)).toBe('xl.jpg')
    delete (globalThis as any).window
  })

  it('cardCover falls back when a snapshot predates the large field', () => {
    ;(globalThis as any).window = { devicePixelRatio: 1 }
    expect(cardCover({ id: 1, title: {}, coverImage: { extraLarge: 'xl.jpg', medium: 'm.jpg' } } as any, 152)).toBe('xl.jpg')
    expect(cardCover({ id: 1, title: {}, coverImage: { medium: 'm.jpg' } } as any, 152)).toBe('m.jpg')
    expect(cardCover({ id: 1, title: {} } as any, 152)).toBe('')
    delete (globalThis as any).window
  })
  it('format maps enum to label', () => {
    expect(format({ id: 1, title: {}, format: 'TV_SHORT' } as any)).toBe('TV Short')
    expect(format({ id: 1, title: {}, format: 'MOVIE' } as any)).toBe('Movie')
    expect(format({ id: 1, title: {}, format: 'NOVEL' } as any)).toBe('Novel')
  })
  it('routes manga and novels to the information-only detail page', () => {
    expect(mediaHref({ id: 1, type: 'ANIME', title: {} })).toBe('/app/anime/1')
    expect(mediaHref({ id: 2, type: 'MANGA', format: 'MANGA', title: {} })).toBe('/app/manga/2')
    expect(mediaHref({ id: 3, type: 'MANGA', format: 'NOVEL', title: {} })).toBe('/app/manga/3')
  })
  it('recognises reading media from its format when a trimmed projection omits `type`', () => {
    // Related-title nodes reach the player through a slim query that has historically not asked for
    // `type`. Sending such a node to the anime route asks AniList for `Media(id, type: ANIME)`, which
    // answers "Not Found" — the detail page then renders a bare load failure instead of the title.
    expect(mediaHref({ id: 4, format: 'MANGA', title: {} })).toBe('/app/manga/4')
    expect(mediaHref({ id: 5, format: 'NOVEL', title: {} })).toBe('/app/manga/5')
    expect(mediaHref({ id: 6, format: 'ONE_SHOT', title: {} })).toBe('/app/manga/6')
    expect(isReadingMedia({ id: 7, format: 'MANGA', title: {} })).toBe(true)
  })
  it('never re-routes a declared anime, whatever its format says', () => {
    expect(mediaHref({ id: 8, type: 'ANIME', format: 'TV', title: {} })).toBe('/app/anime/8')
    expect(mediaHref({ id: 9, type: 'ANIME', format: 'MANGA', title: {} })).toBe('/app/anime/9')
    expect(mediaHref({ id: 10, format: 'OVA', title: {} })).toBe('/app/anime/10')
    expect(mediaHref({ id: 11, title: {} })).toBe('/app/anime/11')
    expect(isReadingMedia({ id: 12, format: 'TV', title: {} })).toBe(false)
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

  it('does not treat a releasing title planned total as its aired count', () => {
    const malOnly = {
      id: 1, title: {}, status: 'RELEASING', episodes: 12,
      nextAiringEpisode: null, airingSchedule: { nodes: [] },
    } as any
    expect(airedCount(malOnly)).toBe(Infinity)
    expect(hasAiredEpisodeToWatch(malOnly, 7)).toBe(true)
  })

  it('reports zero aired episodes for a not-yet-released title', () => {
    const future = { id: 1, title: {}, status: 'NOT_YET_RELEASED', episodes: 12 } as any
    expect(airedCount(future)).toBe(0)
    expect(hasAiredEpisodeToWatch(future, 0)).toBe(false)
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
