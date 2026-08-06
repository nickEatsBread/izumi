import { beforeEach, describe, it, expect, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: mocks.fetch }))

import { firstOccurrences } from './animethemes'

const respond = (body: unknown) =>
  mocks.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(body) })

// One Piece-shaped payload: OP debuts on episode 1000, ED on episode 1.
const ANIME = {
  anime: [{
    animethemes: [
      { type: 'OP', animethemeentries: [{ episodes: '1000-1027' }] },
      { type: 'ED', animethemeentries: [{ episodes: '1-30' }] },
    ],
  }],
}

beforeEach(() => mocks.fetch.mockReset())

describe('firstOccurrences', () => {
  it('scopes the query with filter[has]=resources so the external_id filter binds', async () => {
    // Regression: without filter[has]=resources the AnimeThemes API silently ignores the
    // resource-scoped filters and returns page 1 of the whole database — the debut guard
    // then computes its answer from ~15 unrelated shows.
    respond(ANIME)
    await firstOccurrences(21, 1000)
    const url = mocks.fetch.mock.calls[0][0] as string
    expect(url).toContain('filter[has]=resources')
    expect(url).toContain('filter[external_id]=21')
    expect(url).toContain('filter[site]=AniList')
  })

  it('flags the debut episode of an OP/ED from the entry range', async () => {
    respond(ANIME)
    expect(await firstOccurrences(21, 1000)).toEqual({ op: true, ed: false })
    respond(ANIME)
    expect(await firstOccurrences(21, 1)).toEqual({ op: false, ed: true })
    respond(ANIME)
    expect(await firstOccurrences(21, 500)).toEqual({ op: false, ed: false })
  })

  it('falls back to "episode 1 is the debut" when AnimeThemes has no data', async () => {
    respond({ anime: [] })
    expect(await firstOccurrences(21, 1)).toEqual({ op: true, ed: true })
    respond({ anime: [] })
    expect(await firstOccurrences(21, 2)).toEqual({ op: false, ed: false })
    expect(await firstOccurrences(null, 1)).toEqual({ op: true, ed: true })
  })
})
