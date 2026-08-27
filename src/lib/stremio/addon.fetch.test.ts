import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ phttp: vi.fn(), fetchManifest: vi.fn(), peekManifest: vi.fn() }))

vi.mock('$lib/net/http', () => ({ phttp: mocks.phttp }))
// Keep the real acceptsStreamId: stubbing the whole module would silently disable the
// id gate that the fetch path now depends on.
vi.mock('./manifest', async (actual) => ({
  ...(await actual() as object),
  fetchManifest: mocks.fetchManifest,
  peekManifest: mocks.peekManifest,
}))

import { fetchAddonStreams, streamBudgetMs } from './addon'

const streamResponse = (streams: unknown[]) => ({ ok: true, json: async () => ({ streams }) })
const never = () => new Promise<never>(() => {})

beforeEach(() => {
  vi.useFakeTimers()
  mocks.phttp.mockReset()
  mocks.fetchManifest.mockReset()
  mocks.peekManifest.mockReset()
  mocks.peekManifest.mockReturnValue(undefined)
  mocks.fetchManifest.mockResolvedValue({ id: 'a', name: 'Addon', version: '1', logo: 'https://logo' })
})
afterEach(() => vi.useRealTimers())

describe('per-addon stream budget', () => {
  it('gives a known-slow addon a longer budget than the default', () => {
    expect(streamBudgetMs('https://comet.example.org')).toBeGreaterThan(streamBudgetMs('https://plain.example.org'))
  })

  it('recognises a slow family anywhere in the URL, not just the host', () => {
    expect(streamBudgetMs('https://elfhosted.com/mediafusion/abc')).toBe(streamBudgetMs('https://comet.example.org'))
  })

  it('gives the native request a deadline just past the budget, inside the Rust 1s-60s clamp', async () => {
    mocks.phttp.mockResolvedValue(streamResponse([{ url: 'u1', name: 'x' }]))

    for (const base of ['https://plain.example.org', 'https://comet.example.org']) {
      mocks.phttp.mockClear()
      const p = fetchAddonStreams(base, 'kitsu:1:1')
      await vi.advanceTimersByTimeAsync(50)
      await p

      const { timeoutMs } = mocks.phttp.mock.calls[0][1]
      // Strictly after the JS budget, so a barely-late response still reaches `onLate`.
      expect(timeoutMs).toBeGreaterThan(streamBudgetMs(base))
      expect(timeoutMs).toBeGreaterThanOrEqual(1_000)
      expect(timeoutMs).toBeLessThanOrEqual(60_000)
    }
  })
})

describe('manifest is decoupled from the stream fetch', () => {
  it('returns streams even when the manifest never resolves', async () => {
    mocks.phttp.mockResolvedValue(streamResponse([{ url: 'u1', name: 'x' }]))
    mocks.fetchManifest.mockImplementation(never)

    const p = fetchAddonStreams('https://plain.example.org', 'kitsu:1:1')
    await vi.advanceTimersByTimeAsync(50)

    expect((await p).streams).toHaveLength(1)
  })

  it('stamps the addon logo and name when the manifest arrives in time', async () => {
    mocks.phttp.mockResolvedValue(streamResponse([{ url: 'u1', name: 'x' }]))

    const p = fetchAddonStreams('https://plain.example.org', 'kitsu:1:1')
    await vi.advanceTimersByTimeAsync(50)
    const { streams } = await p

    expect(streams[0].__logo).toBe('https://logo')
    expect(streams[0].__addonName).toBe('Addon')
  })

  it('retains the request-scoped order supplied by an upstream addon', async () => {
    mocks.phttp.mockResolvedValue(streamResponse([
      { url: 'u1', name: 'first' },
      { url: 'u2', name: 'second' },
    ]))

    const p = fetchAddonStreams('https://plain.example.org', 'kitsu:1:1')
    await vi.advanceTimersByTimeAsync(50)
    const { streams } = await p

    expect(streams.map((stream) => stream.__evidence)).toEqual([
      { upstreamRank: 0, requestId: 'kitsu:1:1' },
      { upstreamRank: 1, requestId: 'kitsu:1:1' },
    ])
  })

  it('uses an already-warmed manifest to avoid unsupported id requests', async () => {
    mocks.peekManifest.mockReturnValue({
      id: 'imdb-only', name: 'IMDb only', version: '1',
      resources: [{ name: 'stream', types: ['series'], idPrefixes: ['tt'] }],
    })
    mocks.phttp.mockResolvedValue(streamResponse([{ url: 'u1', name: 'x' }]))

    const p = fetchAddonStreams('https://plain.example.org', ['tt123:1:1', 'tmdb:123:1:1'])
    await vi.advanceTimersByTimeAsync(50)
    const { streams } = await p

    expect(streams).toHaveLength(1)
    expect(mocks.phttp).toHaveBeenCalledTimes(1)
    expect(mocks.phttp.mock.calls[0][0]).toContain('/stream/series/tt123%3A1%3A1.json')
  })

  it('still yields streams when the manifest fetch rejects', async () => {
    mocks.phttp.mockResolvedValue(streamResponse([{ url: 'u1', name: 'x' }]))
    mocks.fetchManifest.mockRejectedValue(new Error('boom'))

    const p = fetchAddonStreams('https://plain.example.org', 'kitsu:1:1')
    await vi.advanceTimersByTimeAsync(50)

    expect((await p).streams).toHaveLength(1)
  })
})

describe('late responses are folded in, not discarded', () => {
  it('hands a response that blew its budget to the late callback', async () => {
    let release!: (v: unknown) => void
    mocks.phttp.mockReturnValue(new Promise((res) => { release = res }))
    const late = vi.fn()

    const p = fetchAddonStreams('https://plain.example.org', 'kitsu:1:1', 'series', late)
    await vi.advanceTimersByTimeAsync(streamBudgetMs('https://plain.example.org') + 10)

    expect((await p).streams).toHaveLength(0)
    expect(late).not.toHaveBeenCalled()

    release(streamResponse([{ url: 'u1', name: 'x' }]))
    await vi.advanceTimersByTimeAsync(10)

    expect(late).toHaveBeenCalledTimes(1)
    expect(late.mock.calls[0][0].streams).toHaveLength(1)
  })

  it('does not call the late callback when the response beat its budget', async () => {
    mocks.phttp.mockResolvedValue(streamResponse([{ url: 'u1', name: 'x' }]))
    const late = vi.fn()

    const p = fetchAddonStreams('https://plain.example.org', 'kitsu:1:1', 'series', late)
    await vi.advanceTimersByTimeAsync(50)
    await p
    await vi.advanceTimersByTimeAsync(30_000)

    expect(late).not.toHaveBeenCalled()
  })

  it('does not call the late callback when a late response carries no streams', async () => {
    let release!: (v: unknown) => void
    mocks.phttp.mockReturnValue(new Promise((res) => { release = res }))
    const late = vi.fn()

    const p = fetchAddonStreams('https://plain.example.org', 'kitsu:1:1', 'series', late)
    await vi.advanceTimersByTimeAsync(streamBudgetMs('https://plain.example.org') + 10)
    await p

    release(streamResponse([]))
    await vi.advanceTimersByTimeAsync(10)

    expect(late).not.toHaveBeenCalled()
  })
})
