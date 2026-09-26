import { describe, expect, it, vi } from 'vitest'
vi.mock('$lib/anilist/client', () => ({ anilist: {} }))
vi.mock('$lib/catalog/registry', () => ({ loadCatalogProvider: vi.fn() }))
import { genreChipList } from './genres'

describe('genre chips', () => {
  it('shows popular genres the catalog has, in their popular order', () => {
    expect(genreChipList('top', ['Drama', 'Action', 'Ecchi', 'Comedy'])).toEqual(['Action', 'Comedy', 'Drama'])
    expect(genreChipList('top', null)).toContain('Action')
  })

  it('keeps chosen genres in the chosen order, matched case-insensitively', () => {
    expect(genreChipList(['comedy', 'Mecha', 'Drama'], ['Drama', 'Comedy'])).toEqual(['Comedy', 'Drama'])
    expect(genreChipList(['Mecha'], null)).toEqual(['Mecha'])
  })
})
