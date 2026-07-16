import { describe, it, expect } from 'vitest'
import { get } from 'svelte/store'
import { addonOriginId, addonUrls, disabledSources, enabledAddonUrls } from './sources'

describe('enabledAddonUrls', () => {
  it('filters out disabled sources, keeps the rest', () => {
    addonUrls.set(['https://a', 'https://b', 'https://c'])
    disabledSources.set(['https://b'])
    expect(get(enabledAddonUrls)).toEqual(['https://a', 'https://c'])
    disabledSources.set([])
    expect(get(enabledAddonUrls)).toEqual(['https://a', 'https://b', 'https://c'])
    addonUrls.set([]); disabledSources.set([])
  })
})

describe('addonOriginId', () => {
  it('matches normalized forms without exposing a credential-bearing URL', () => {
    const url = 'https://example.com/secret-api-key/manifest.json'
    const id = addonOriginId(url)
    expect(id).toBe(addonOriginId('https://example.com/secret-api-key'))
    expect(id).not.toContain('secret-api-key')
    expect(id).toMatch(/^[a-f0-9]{16}$/)
  })
})
