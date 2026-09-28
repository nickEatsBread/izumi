import { describe, expect, it } from 'vitest'
import { browseAllHref, categoriesCatalog, categoriesPanelPlace, genreHref } from './categories'

describe('categoriesCatalog', () => {
  it('browses the catalog on screen', () => {
    expect(categoriesCatalog('anilist', ['anilist'])).toEqual({ catalog: 'anilist' })
    expect(categoriesCatalog('auto', ['auto', 'tmdb'])).toEqual({ catalog: 'auto' })
    expect(categoriesCatalog('tmdb', ['auto', 'tmdb'])).toEqual({ catalog: 'tmdb' })
  })
  it('scopes a merged screen to a catalog merged search can filter in, AniList-based first', () => {
    expect(categoriesCatalog('merged', ['tmdb', 'auto'])).toEqual({ catalog: 'auto', provider: 'auto' })
    expect(categoriesCatalog('merged', ['anilist', 'tmdb'])).toEqual({ catalog: 'anilist', provider: 'anilist' })
    // Automatic anime already covers AniList, so merged search offers `auto` and never `anilist` beside it.
    expect(categoriesCatalog('merged', ['anilist', 'auto', 'stremio'])).toEqual({ catalog: 'auto', provider: 'auto' })
    expect(categoriesCatalog('merged', ['tmdb', 'stremio'])).toEqual({ catalog: 'tmdb', provider: 'tmdb' })
  })
})

describe('Categories links', () => {
  it('open AniList search on a genre, or sorted by popularity', () => {
    const anilist = categoriesCatalog('auto', ['auto'])
    expect(genreHref(anilist, 'Slice of Life')).toBe('/app/search?genre=Slice+of+Life')
    expect(new URL(genreHref(anilist, 'Slice of Life'), 'http://x').searchParams.get('genre')).toBe('Slice of Life')
    expect(browseAllHref(anilist)).toBe('/app/search?sort=POPULARITY_DESC')
  })
  it('name the merged scope, so merged search filters inside it', () => {
    const merged = categoriesCatalog('merged', ['auto', 'tmdb'])
    expect(genreHref(merged, 'Action')).toBe('/app/search?provider=auto&genre=Action')
    expect(browseAllHref(merged)).toBe('/app/search?provider=auto&sort=POPULARITY_DESC')
  })
  it('leave provider catalogs on their own sorts', () => {
    const tmdb = categoriesCatalog('tmdb', ['tmdb'])
    expect(genreHref(tmdb, 'Animation')).toBe('/app/search?genre=Animation')
    expect(browseAllHref(tmdb)).toBe('/app/search')
    expect(browseAllHref(categoriesCatalog('merged', ['tmdb', 'stremio']))).toBe('/app/search?provider=tmdb')
  })
})

describe('categoriesPanelPlace', () => {
  it('sits under its button and slides left until its real width fits the window', () => {
    expect(categoriesPanelPlace({ left: 300, bottom: 76 }, 850, 1600)).toEqual({ left: 300, top: 76 })
    expect(categoriesPanelPlace({ left: 600, bottom: 76 }, 850, 1280)).toEqual({ left: 1280 - 850 - 8, top: 76 })
    expect(categoriesPanelPlace({ left: 600, bottom: 76 }, 1400, 1280).left).toBe(8)
  })
  it('measures in screen px and places in the zoomed page\'s px', () => {
    expect(categoriesPanelPlace({ left: 600, bottom: 120 }, 900, 1920, 1.5)).toEqual({ left: 400, top: 80 })
    expect(categoriesPanelPlace({ left: 1500, bottom: 120 }, 900, 1920, 1.5)).toEqual({ left: (1920 - 900 - 12) / 1.5, top: 80 })
  })
})
