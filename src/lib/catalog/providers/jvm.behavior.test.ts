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
      'Popular · One', 'Latest updates · One', 'Popular · Two', 'Latest updates · Two',
    ])
    expect(mocks.browse).toHaveBeenCalledTimes(4)
  })

  it('does not query sources explicitly filtered out of the JVM catalog', async () => {
    jvmCatalogSourceOverrides.set({ one: false })
    await jvmCatalog.search({ query: 'Frieren', page: 1 })
    expect(mocks.browse).toHaveBeenCalledTimes(1)
    expect(mocks.browse).toHaveBeenCalledWith('two', 'search', 1, 'Frieren')
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

  it('loads detail and episode data from the owning source', async () => {
    mocks.detail.mockResolvedValue({
      title: 'Frieren', url: '/frieren', cover: 'https://img/frieren.jpg',
      episodes: [{ name: 'Episode 1', url: '/frieren/1', episode_number: 1 }],
    })
    const id = encodeJvmIdentity({ sourceId: 'one', url: '/frieren', title: 'Frieren' })
    const media = await jvmCatalog.detail({ provider: 'jvm', type: 'anime', id })
    expect(mocks.detail).toHaveBeenCalledWith('one', {
      url: '/frieren', title: 'Frieren', thumbnail_url: '',
    })
    expect(media?.videos).toEqual([{
      id: JSON.stringify({ url: '/frieren/1', name: 'Episode 1' }),
      number: 1, episode: 1, season: undefined, title: 'Episode 1',
    }])
  })
})
