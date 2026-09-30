import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Media } from '$lib/anilist/types'

const mocks = vi.hoisted(() => ({ anilist: vi.fn(), close: vi.fn() }))
vi.mock('$lib/anilist/abortable-query', () => ({ queryAniList: mocks.anilist }))
vi.mock('$lib/search/close-matches', () => ({ closeMatches: mocks.close }))
vi.mock('./registry', () => ({ loadCatalogProvider: vi.fn() }))

import { searchMergedCatalogs } from './merged-search'

const media = (id: number, english: string): Media => ({ id, title: { english } })
const answer = (items: Media[]) => ({ data: { Page: { media: items } } })

beforeEach(() => {
  mocks.anilist.mockReset().mockResolvedValue(answer([]))
  mocks.close.mockReset().mockResolvedValue([media(154587, 'Frieren: Beyond Journey’s End')])
})

describe('merged catalog search', () => {
  it("adds the close matches AniList's exact-word search missed", async () => {
    const result = await searchMergedCatalogs(['auto'], 'freiren')
    expect(result.media.map((item) => item.id)).toEqual([154587])
    expect(mocks.close).toHaveBeenCalledWith('freiren', expect.objectContaining({}))
  })

  it("leaves a plain match alone", async () => {
    mocks.anilist.mockResolvedValue(answer([media(154587, 'Frieren')]))
    await searchMergedCatalogs(['auto'], 'frieren')
    expect(mocks.close).not.toHaveBeenCalled()
  })

  it('looks for close matches only on the first page of a title search', async () => {
    await searchMergedCatalogs(['auto'], 'freiren', 2)
    await searchMergedCatalogs(['auto'], '', 1, undefined, 'Comedy')
    await searchMergedCatalogs(['auto'], 'freiren', 1, undefined, 'Comedy')
    expect(mocks.close).not.toHaveBeenCalled()
  })

  it("keeps AniList's own record when a close match is the same title, with the close matches first", async () => {
    // "dmon slayer" finds the series in AniList too, but not closely enough to skip the lookup.
    const own = { ...media(101922, 'Demon Slayer: Kimetsu no Yaiba'), genres: ['Action'] }
    const unrelated = media(1, 'Dmon Stories')
    mocks.anilist.mockResolvedValue(answer([unrelated, own]))
    mocks.close.mockResolvedValue([media(101922, 'Demon Slayer: Kimetsu no Yaiba'), media(142329, 'Demon Slayer: Entertainment District Arc')])
    const result = await searchMergedCatalogs(['auto'], 'dmon slayer')
    expect(result.media.map((item) => item.id)).toEqual([101922, 142329, 1])
    expect(result.media[0]).toBe(own)
  })

  it('passes the cancel signal to AniList', async () => {
    const abort = new AbortController()
    await searchMergedCatalogs(['auto'], 'frieren', 1, abort.signal)
    expect(mocks.anilist.mock.calls[0][2]).toBe(abort.signal)
  })
})
