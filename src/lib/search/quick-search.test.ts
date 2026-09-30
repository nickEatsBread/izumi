import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Media } from '$lib/anilist/types'

const mocks = vi.hoisted(() => ({ anilist: vi.fn(), provider: vi.fn(), close: vi.fn() }))
vi.mock('$lib/anilist/abortable-query', () => ({ queryAniList: mocks.anilist }))
vi.mock('$lib/catalog/registry', () => ({ loadCatalogProvider: async () => ({ search: mocks.provider }) }))
vi.mock('./close-matches', () => ({ lookUpCloseMatches: mocks.close }))

import { cachedQuickSearch, quickSearch } from './quick-search'

const media = (id: number, english: string, extra: Partial<Media> = {}): Media => ({ id, title: { english }, ...extra })
const jvm = (id: number, english: string): Media =>
  media(id, english, { catalog: { provider: 'jvm', type: 'anime', id: String(id) } })
const aniList = (items: Media[]) => ({ data: { Page: { media: items } } })
const close = (items: Media[], complete = true) => ({ media: items, complete })

// Answers are remembered for two minutes, so each test searches a query of its own.
let searches = 0
const fresh = (text: string) => `${text} ${'x'.repeat(++searches)}`

beforeEach(() => {
  mocks.anilist.mockReset().mockResolvedValue(aniList([]))
  mocks.provider.mockReset().mockResolvedValue({ media: [], page: 1, hasNextPage: false })
  mocks.close.mockReset().mockResolvedValue(close([]))
})

describe('quickSearch', () => {
  it("shows AniList's answer without waiting for a slow catalog", async () => {
    const text = fresh('frieren')
    mocks.anilist.mockResolvedValue(aniList([media(154587, `Frieren ${text.split(' ')[1]}`)]))
    let finishSource: (value: unknown) => void = () => {}
    mocks.provider.mockReturnValue(new Promise((resolve) => { finishSource = resolve }))
    const updates: Media[][] = []
    const pending = quickSearch(text, ['auto', 'jvm'], { onUpdate: (items) => updates.push(items) })
    await vi.waitFor(() => expect(updates.some((items) => items.some((item) => item.id === 154587))).toBe(true))
    finishSource({ media: [], page: 1, hasNextPage: false })
    await expect(pending).resolves.toEqual([expect.objectContaining({ id: 154587 })])
  })

  it('adds close matches for typos while AniList is one of the catalogs', async () => {
    mocks.close.mockResolvedValue(close([media(154587, 'Frieren: Beyond Journey’s End')]))
    const found = await quickSearch('freiren', ['auto'])
    expect(found.map((item) => item.id)).toEqual([154587])
    expect(mocks.close).toHaveBeenCalledWith('freiren', expect.objectContaining({}))
  })

  it('does not bring AniList titles into a search of catalogs without AniList', async () => {
    mocks.provider.mockResolvedValue({ media: [jvm(-1, 'Frieren')], page: 1, hasNextPage: false })
    await quickSearch(fresh('frieren'), ['jvm'])
    expect(mocks.close).not.toHaveBeenCalled()
  })

  it("prefers a catalog's own record over a close-match stand-in for the same title", async () => {
    const text = fresh('frieren')
    mocks.close.mockResolvedValue(close([media(154587, text, { synonyms: ['from kitsu'] })]))
    mocks.anilist.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return aniList([media(154587, text, { synonyms: ['from anilist'] })])
    })
    const [first] = await quickSearch(text, ['auto'])
    expect(first.synonyms).toEqual(['from anilist'])
  })

  it('drops a source listing that has nothing to do with the query', async () => {
    mocks.close.mockResolvedValue(close([media(154587, 'Frieren: Beyond Journey’s End')]))
    mocks.provider.mockResolvedValue({ media: [jvm(-1, 'You Shou Yan 6th Season'), jvm(-2, 'Li Xiongmao')], page: 1, hasNextPage: false })
    expect((await quickSearch('freiren', ['auto', 'jvm'])).map((item) => item.id)).toEqual([154587])
  })

  it('hands every source the cancel signal and gives up when the query changes', async () => {
    const abort = new AbortController()
    mocks.provider.mockImplementation(() => new Promise(() => {}))
    mocks.anilist.mockImplementation(() => new Promise(() => {}))
    const text = fresh('frieren')
    const pending = quickSearch(text, ['auto', 'jvm'], { signal: abort.signal })
    await vi.waitFor(() => expect(mocks.provider).toHaveBeenCalled())
    expect(mocks.provider.mock.calls[0][0]).toMatchObject({ query: text, signal: abort.signal })
    expect(mocks.anilist.mock.calls[0][2]).toBe(abort.signal)
    abort.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(cachedQuickSearch(text, ['auto', 'jvm'])).toBeUndefined()
  })

  it('fails only when every catalog failed and nothing close was found', async () => {
    mocks.anilist.mockRejectedValue(new Error('AniList is down'))
    await expect(quickSearch(fresh('frieren'), ['auto'])).rejects.toThrow('AniList is down')
    mocks.close.mockResolvedValue(close([media(154587, 'Frieren')]))
    await expect(quickSearch('frieren', ['auto'])).resolves.toHaveLength(1)
  })

  it('remembers the finished answer', async () => {
    const text = fresh('frieren')
    mocks.anilist.mockResolvedValue(aniList([media(154587, text)]))
    await quickSearch(text, ['auto'])
    expect(cachedQuickSearch(text, ['auto'])?.map((item) => item.id)).toEqual([154587])
  })
})

describe('quickSearch respellings and memory', () => {
  it("lets close matches wait for AniList's answer and see whether a catalog already holds the title", async () => {
    const text = fresh('breaking bad')
    mocks.anilist.mockResolvedValue(aniList([]))
    mocks.provider.mockResolvedValue({ media: [media(-9, text, { catalog: { provider: 'tmdb', type: 'series', id: '9' } })], page: 1, hasNextPage: false })
    await quickSearch(text, ['auto', 'tmdb'])
    const [, options] = mocks.close.mock.calls[0]
    await expect(options.answered).resolves.toEqual([])
    expect(options.found()).toBe(true)
  })

  it('does not remember an empty answer that a failed lookup may have cut short', async () => {
    const text = fresh('oshinoko')
    mocks.close.mockResolvedValue(close([], false))
    expect(await quickSearch(text, ['auto'])).toEqual([])
    expect(cachedQuickSearch(text, ['auto'])).toBeUndefined()
  })
})
