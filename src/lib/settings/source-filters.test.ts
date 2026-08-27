import { describe, expect, it } from 'vitest'
import { matchesSourceFilters, matchesSourceQuery, sortManagedSources } from './source-filters'

describe('My sources filters', () => {
  it('filters ordinary sources by their switch state', () => {
    const enabled = { types: ['addon'] as const, enabled: true, disabled: false }
    const disabled = { types: ['community'] as const, enabled: false, disabled: true }

    expect(matchesSourceFilters(enabled, 'enabled', 'all')).toBe(true)
    expect(matchesSourceFilters(enabled, 'disabled', 'all')).toBe(false)
    expect(matchesSourceFilters(disabled, 'disabled', 'all')).toBe(true)
  })

  it('filters by the source categories shown in the UI', () => {
    const addon = { types: ['addon'] as const, enabled: true, disabled: false }
    expect(matchesSourceFilters(addon, 'all', 'addon')).toBe(true)
    expect(matchesSourceFilters(addon, 'all', 'community')).toBe(false)
  })

  it('allows a mixed catalog to appear under either package status', () => {
    const catalog = {
      types: ['catalog', 'package'] as const,
      enabled: true,
      disabled: true,
    }
    expect(matchesSourceFilters(catalog, 'enabled', 'catalog')).toBe(true)
    expect(matchesSourceFilters(catalog, 'disabled', 'package')).toBe(true)
  })

  it('matches source search text case-insensitively across names, ids, and URLs', () => {
    expect(matchesSourceQuery('ANIDB', 'AniDB', 'eu.kanade.anidb')).toBe(true)
    expect(matchesSourceQuery('torrentio', 'https://torrentio.strem.fun')).toBe(true)
    expect(matchesSourceQuery('missing', 'AniDB', 'https://example.test')).toBe(false)
    expect(matchesSourceQuery('   ', undefined)).toBe(true)
  })

  it('sorts enabled sources first by default and supports explicit name ordering', () => {
    const rows = [
      { id: 'b', label: 'Beta', enabled: false, disabled: true },
      { id: 'z', label: 'Zulu', enabled: true, disabled: false },
      { id: 'a', label: 'Alpha', enabled: true, disabled: false },
    ]

    expect(sortManagedSources(rows, 'enabled').map((row) => row.id)).toEqual(['a', 'z', 'b'])
    expect(sortManagedSources(rows, 'disabled').map((row) => row.id)).toEqual(['b', 'a', 'z'])
    expect(sortManagedSources(rows, 'name-asc').map((row) => row.id)).toEqual(['a', 'b', 'z'])
    expect(sortManagedSources(rows, 'name-desc').map((row) => row.id)).toEqual(['z', 'b', 'a'])
    expect(sortManagedSources(rows, 'added').map((row) => row.id)).toEqual(['b', 'z', 'a'])
  })
})
