import { afterEach, describe, expect, it, vi } from 'vitest'
import { writable } from 'svelte/store'

const mocks = vi.hoisted(() => ({ phttp: vi.fn() }))
const addons = writable<string[]>([])
vi.mock('$lib/net/http', () => ({ phttp: mocks.phttp }))
vi.mock('$lib/stremio/manifest', () => ({
  fetchManifest: async () => ({
    id: 'test', name: 'Test', version: '1', resources: ['catalog'], types: ['movie'],
    catalogs: [{ type: 'movie', id: 'top', name: 'Top', extra: [{ name: 'search' }] }],
  }),
}))
vi.mock('$lib/stremio/sources', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  enabledAddonUrls: { subscribe: addons.subscribe },
}))

const { stremioCatalog } = await import('./stremio')

const answer = (name: string) => ({ ok: true, status: 200, json: async () => ({ metas: [{ id: `tt-${name}`, type: 'movie', name }] }) })
// A host that never answers: the request settles only when it is cancelled.
const hang = (_url: string, init: { signal?: AbortSignal }) => new Promise((_, reject) => {
  init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
})
const route = (dead: string) => (url: string, init: { signal?: AbortSignal }) =>
  url.startsWith(dead) ? hang(url, init) : Promise.resolve(answer(new URL(url).host))
const search = (signal?: AbortSignal) => stremioCatalog.search({ query: 'title', page: 1, type: 'all', sort: 'popular', signal })
const asked = (host: string) => mocks.phttp.mock.calls.filter(([url]) => String(url).includes(host)).length

afterEach(() => {
  vi.useRealTimers()
  mocks.phttp.mockReset()
})

describe('Stremio catalog search', () => {
  it('answers with the add-ons that answered instead of waiting on one that is down, then stops asking it', async () => {
    vi.useFakeTimers()
    addons.set(['https://fast-a.test', 'https://dead-a.test'])
    // A gateway that answers 504 only after 12 s.
    mocks.phttp.mockImplementation((url: string) => url.includes('dead-a.test')
      ? new Promise((resolve) => setTimeout(() => resolve({ ok: false, status: 504, json: async () => ({}) }), 12_000))
      : Promise.resolve(answer(new URL(url).host)))
    const pending = search()
    await vi.advanceTimersByTimeAsync(2_000)
    expect((await pending).media.map((item) => item.title.english)).toEqual(['fast-a.test'])
    await vi.advanceTimersByTimeAsync(10_000)

    mocks.phttp.mockClear()
    const next = await search()
    expect(next.media).toHaveLength(1)
    expect(asked('dead-a.test')).toBe(0)
  })

  it('never benches a catalog that is only slow', async () => {
    vi.useFakeTimers()
    addons.set(['https://fast-d.test', 'https://slow-d.test'])
    mocks.phttp.mockImplementation((url: string) => url.includes('slow-d.test')
      ? new Promise((resolve) => setTimeout(() => resolve(answer('slow-d.test')), 3_000))
      : Promise.resolve(answer(new URL(url).host)))
    const pending = search()
    await vi.advanceTimersByTimeAsync(2_000)
    expect((await pending).media).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1_000)
    mocks.phttp.mockClear()
    const next = search()
    await vi.advanceTimersByTimeAsync(2_000)
    await next
    // Still asked: being slow is not being down.
    expect(asked('slow-d.test')).toBe(1)
  })

  it('benches an add-on whose search fails, but asks again when every add-on is benched', async () => {
    addons.set(['https://broken-b.test'])
    mocks.phttp.mockResolvedValue({ ok: false, status: 504, json: async () => ({}) })
    expect((await search()).media).toEqual([])
    await search()
    expect(asked('broken-b.test')).toBe(2)
  })

  it('benches nothing when the search itself is cancelled', async () => {
    addons.set(['https://fast-c.test', 'https://slow-c.test'])
    mocks.phttp.mockImplementation(route('https://slow-c.test'))
    const abort = new AbortController()
    const pending = search(abort.signal)
    await vi.waitFor(() => expect(asked('slow-c.test')).toBe(1))
    abort.abort()
    await pending
    mocks.phttp.mockReset().mockImplementation((url: string) => Promise.resolve(answer(new URL(url).host)))
    expect((await search()).media).toHaveLength(2)
  })
})
