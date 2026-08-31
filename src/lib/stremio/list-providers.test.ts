import { describe, expect, it } from 'vitest'
import { LIST_PROVIDERS, listProviderByAddonId, listProviderOwnsUrl } from './list-providers'

describe('list providers', () => {
  it('defines unique secure account entry points', () => {
    expect(new Set(LIST_PROVIDERS.map((entry) => entry.id)).size).toBe(LIST_PROVIDERS.length)
    expect(new Set(LIST_PROVIDERS.map((entry) => entry.addonId)).size).toBe(LIST_PROVIDERS.length)
    for (const entry of LIST_PROVIDERS) {
      expect(entry.base).toMatch(/^https:\/\//)
      expect(entry.configureUrl).toMatch(/^https:\/\//)
      expect(listProviderByAddonId(entry.addonId)).toBe(entry)
    }
  })

  it('recognizes private configured manifests on the provider origin', () => {
    const trakt = LIST_PROVIDERS.find((provider) => provider.id === 'trakt')!
    expect(listProviderOwnsUrl(trakt, `${trakt.base}/u/private-token/manifest.json`)).toBe(true)
    expect(listProviderOwnsUrl(trakt, 'https://example.com/manifest.json')).toBe(false)
    expect(listProviderOwnsUrl(trakt, 'not a url')).toBe(false)
  })
})
