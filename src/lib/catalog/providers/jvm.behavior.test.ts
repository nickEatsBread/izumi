import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  browse: vi.fn(),
  detail: vi.fn(),
  sources: vi.fn(),
}))

vi.mock('$lib/extensions/manager', () => ({
  browseJvmCatalogSource: mocks.browse,
  detailJvmCatalogSource: mocks.detail,
  installedJvmCatalogSources: mocks.sources,
}))

const { jvmCatalog, encodeJvmIdentity } = await import('./jvm')
const { catalogHomeLayouts } = await import('../home-layout')
const { jvmCatalogSourceOverrides } = await import('$lib/settings/catalog')

const sources = [
  { id: 'one', name: 'One', lang: 'en', supportsPopular: true, supportsLatest: true },
  { id: 'two', name: 'Two', lang: 'en', supportsPopular: true, supportsLatest: true },
]

describe('JVM catalog provider', () => {
  beforeEach(() => {
    mocks.browse.mockReset()
    mocks.detail.mockReset()
    mocks.sources.mockReset().mockResolvedValue(sources)
    mocks.browse.mockImplementation(async (sourceId: string, method: string) => ({
      list: [{ title: `${method} ${sourceId}`, url: `/${method}/${sourceId}`, cover: `https://img/${sourceId}.jpg` }],
      hasNextPage: false,
    }))
    jvmCatalogSourceOverrides.set({})
    catalogHomeLayouts.set({})
  })

  it('builds popular and latest Home rows for every selected source', async () => {
    const home = await jvmCatalog.home()
    expect(home.sections.map((section) => section.title)).toEqual([
      'Popular · One', 'Popular · Two', 'Latest updates · One', 'Latest updates · Two',
    ])
    expect(mocks.browse).toHaveBeenCalledTimes(4)
  })

  it('keeps unbounded extension pages to the established Home row density', async () => {
    mocks.browse.mockImplementation(async (sourceId: string, method: string) => ({
      list: Array.from({ length: 30 }, (_, index) => ({
        title: `${method} ${sourceId} ${index}`,
        url: `/${method}/${sourceId}/${index}`,
        cover: `https://img/${sourceId}/${index}.jpg`,
      })),
      hasNextPage: true,
    }))

    const home = await jvmCatalog.home()

    expect(home.sections).toHaveLength(4)
    expect(home.sections.every((section) => section.media.length === 20)).toBe(true)
    expect(home.hero).toHaveLength(10)
  })

  it('does not query sources explicitly filtered out of the JVM catalog', async () => {
    jvmCatalogSourceOverrides.set({ one: false })
    await jvmCatalog.search({ query: 'Frieren', page: 1 })
    expect(mocks.browse).toHaveBeenCalledTimes(1)
    expect(mocks.browse).toHaveBeenCalledWith('two', 'search', 1, 'Frieren')
  })

  it('opens native filters only for the explicitly selected source', async () => {
    const filters = [{ name: 'Genre', type: 'Select' as const, state: 2, values: ['Any', 'Action', 'Drama'] }]
    await jvmCatalog.search({ query: 'Frieren', page: 1, sourceId: 'two', jvmFilters: filters })
    expect(mocks.browse).toHaveBeenCalledTimes(1)
    expect(mocks.browse).toHaveBeenCalledWith('two', 'search', 1, 'Frieren', filters, undefined)
  })

  it('groups duplicate titles without losing their alternative source identity', async () => {
    mocks.browse.mockImplementation(async (sourceId: string) => ({
      list: [{ title: 'Frieren', url: `/frieren/${sourceId}` }], hasNextPage: false,
    }))
    const result = await jvmCatalog.search({ query: 'Frieren' })
    expect(result.media).toHaveLength(1)
    expect(result.media[0].catalogAlternatives).toMatchObject([{ sourceName: 'Two' }])
  })

  it('keeps a featured title when every JVM carousel is hidden', async () => {
    catalogHomeLayouts.set({
      jvm: {
        order: ['continue', 'popular:one', 'latest:one', 'popular:two', 'latest:two'],
        disabled: ['popular:one', 'latest:one', 'popular:two', 'latest:two'],
      },
    })
    const home = await jvmCatalog.home()
    expect(home.sections).toEqual([])
    expect(home.hero).toHaveLength(1)
  })

  it('publishes the first completed Home row without waiting for slower sources', async () => {
    let releaseSlow!: () => void
    const slow = new Promise<void>((resolve) => { releaseSlow = resolve })
    mocks.browse.mockImplementation(async (sourceId: string, method: string) => {
      if (sourceId !== 'one' || method !== 'getPopular') await slow
      return {
        list: [{ title: `${method} ${sourceId}`, url: `/${method}/${sourceId}` }],
        hasNextPage: false,
      }
    })
    const updates: Array<{ sections: Array<{ id: string }> }> = []
    const complete = jvmCatalog.home(undefined, undefined, (home) => updates.push(home))

    await vi.waitFor(() => expect(updates.some((home) =>
      home.sections.some((section) => section.id === 'popular:one'))).toBe(true))
    expect(updates.at(-1)?.sections.length).toBeLessThan(4)

    releaseSlow()
    await complete
  })

  it('does not reconcile every previously published card again for each later Home row', async () => {
    const updates: Array<{ sections: Array<{ id: string }> }> = []

    const home = await jvmCatalog.home(undefined, undefined, (update) => updates.push(update))

    expect(updates).toHaveLength(1)
    expect(updates[0].sections).toHaveLength(1)
    expect(home.sections).toHaveLength(4)
  })

  it('never fans Home requests out across the JVM bridge', async () => {
    let active = 0
    let peak = 0
    mocks.browse.mockImplementation(async (sourceId: string, method: string) => {
      active += 1
      peak = Math.max(peak, active)
      await Promise.resolve()
      active -= 1
      return {
        list: [{ title: `${method} ${sourceId}`, url: `/${method}/${sourceId}` }],
        hasNextPage: false,
      }
    })

    await jvmCatalog.home()

    expect(peak).toBe(1)
  })

  it('bounds the whole Home transition when enabled sources never answer', async () => {
    vi.useFakeTimers()
    try {
      mocks.browse.mockImplementation(async (
        _sourceId: string,
        _method: string,
        _page: number,
        _query: string,
        _filters: unknown,
        signal?: AbortSignal,
      ) => new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      }))

      const result = expect(jvmCatalog.home()).rejects.toThrow('did not return Home content within 12 seconds')
      await vi.advanceTimersByTimeAsync(12_000)

      await result
      expect(mocks.browse.mock.calls.length).toBeLessThan(sources.length * 2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits for Home rows before enriching only one featured item', async () => {
    let completedRows = 0
    mocks.browse.mockImplementation(async (sourceId: string, method: string) => {
      completedRows += 1
      return {
        list: [{ title: `${method} ${sourceId}`, url: `/${method}/${sourceId}` }],
        hasNextPage: false,
      }
    })
    mocks.detail.mockImplementation(async () => {
      expect(completedRows).toBe(4)
      return { title: 'Featured', url: '/featured', banner: 'https://img/banner.jpg' }
    })

    await jvmCatalog.home()

    expect(mocks.detail).toHaveBeenCalledTimes(1)
  })

  it('loads detail and episode data from the owning source', async () => {
    mocks.detail.mockResolvedValue({
      title: 'Frieren', url: '/frieren', cover: 'https://img/frieren.jpg',
      episodes: [{
        name: 'Episode 1', url: '/frieren/1', episode_number: 1,
        summary: 'The journey begins.', preview_url: 'https://img/frieren-1.jpg',
        date_upload: 1_700_000_000_000, fillermark: true, scanlator: 'SubsPlease',
      }],
    })
    const id = encodeJvmIdentity({ sourceId: 'one', url: '/frieren', title: 'Frieren' })
    const media = await jvmCatalog.detail({ provider: 'jvm', type: 'anime', id })
    expect(mocks.detail).toHaveBeenCalledWith('one', {
      url: '/frieren', title: 'Frieren', thumbnail_url: '',
    })
    expect(media?.videos).toEqual([{
      id: JSON.stringify({ url: '/frieren/1', name: 'Episode 1' }),
      number: 1, episode: 1, season: undefined, title: 'Episode 1',
      overview: 'The journey begins.', thumbnail: 'https://img/frieren-1.jpg',
      released: '2023-11-14T22:13:20.000Z', filler: true, group: 'SubsPlease',
    }])
  })
})
