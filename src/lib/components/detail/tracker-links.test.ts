import { describe, expect, it } from 'vitest'
import type { Media } from '$lib/anilist/types'
import { detailTrackerLinks, type TrackerConnections } from './tracker-links'

const media = {
  id: 21,
  idMal: 21,
  title: { userPreferred: 'One Piece' },
  seasonYear: 1999,
} as Media

const none: TrackerConnections = { anilist: false, mal: false, kitsu: false, simkl: false }

describe('series tracker links', () => {
  it('shows every resolvable tracker destination', () => {
    const links = detailTrackerLinks(media, none, 12)
    expect(links.map((link) => link.label)).toEqual(['AniList', 'MAL', 'Kitsu', 'SIMKL'])
  })

  it('promotes the viewer’s linked SIMKL account ahead of unlinked trackers', () => {
    const links = detailTrackerLinks(media, { ...none, simkl: true }, 12)
    expect(links.map((link) => link.label)).toEqual(['SIMKL', 'AniList', 'MAL', 'Kitsu'])
    expect(links[0].connected).toBe(true)
  })

  it('builds SIMKL’s documented external-ID redirect with Izumi identification', () => {
    const simkl = detailTrackerLinks(media, none, 12).find((link) => link.id === 'simkl')!
    const url = new URL(simkl.url)
    expect(`${url.origin}${url.pathname}`).toBe('https://api.simkl.com/redirect')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      to: 'simkl', anilist: '21', mal: '21', kitsu: '12',
      title: 'One Piece', year: '1999', 'app-name': 'izumi',
    })
  })
})
