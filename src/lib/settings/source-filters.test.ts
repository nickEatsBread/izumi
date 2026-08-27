import { describe, expect, it } from 'vitest'
import { matchesSourceFilters, matchesSourceQuery } from './source-filters'

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
})
